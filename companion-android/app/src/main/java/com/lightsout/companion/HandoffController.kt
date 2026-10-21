package com.lightsout.companion

import android.content.Context
import android.graphics.Bitmap
import android.util.Base64
import com.google.zxing.BarcodeFormat
import com.google.zxing.qrcode.QRCodeWriter
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Future
import javax.net.ssl.SSLSocket

/** Serialized primary application authority; this class never opens a socket. */
class HandoffController(context:Context) {
    private val context=context.applicationContext
    private val authority=Executors.newSingleThreadExecutor()
    private val readers=Executors.newFixedThreadPool(8)
    private val identity by lazy { HandoffIdentity(this.context) }
    private var currentId:String?=null;private var book:RoutineHandoff.Book?=null;private var inbox:RoutineHandoffInbox?=null
    private data class Connection(val id:String,val peerId:String,val platform:String,val expiresAt:Long,val proof:RoutineHandoff.Peer,val socket:SSLSocket,val link:String,var challenge:ByteArray?=null,var challengeExpires:Long=0)
    private data class Incoming(val id:String,val peerId:String,val bytes:Int,val sha256:String,val expiresAt:Long)
    private data class Preview(val id:String,val peerId:String,val expiresAt:Long,val value:JSONObject)
    private val pending=mutableMapOf<String,Connection>();private val connections=mutableMapOf<String,Connection>();private val offers=mutableMapOf<String,Incoming>()
    private var invitation:JSONObject?=null;private var opened:JSONObject?=null;private var preview:Preview?=null
    private var note="Local pairing screens are ready. LAN transport is disabled in this build."
    private fun closeAll(){(pending.values+connections.values).forEach { try{it.socket.close()}catch(_:Exception){} };pending.clear();connections.clear();offers.clear();preview=null}
    private fun ready():JSONObject {
        val state=identity.status();check(state.getString("status")=="ready") { state.optString("error","Create a device identity first.") }
        val id=state.getString("fingerprint");if(currentId!=id){closeAll();currentId=id;book=RoutineHandoff.Book(id,"android",identity::now,HandoffTrust.storage(identity,id));inbox=RoutineHandoffInbox(context,book!!)};return state
    }
    private fun expire(){if(book==null)return;val now=identity.now();if(invitation?.optLong("expiresAt",0)?.let { it<=now }==true)invitation=null;if(opened?.optLong("expiresAt",0)?.let { it<=now }==true)opened=null
        for((id,p)in pending.toMap())if(p.expiresAt<=now){pending.remove(id);p.socket.close();note="Pairing invitation expired. Generate a new invitation."}
        for((id,o)in offers.toMap())if(o.expiresAt<=now){inbox!!.endpoint.cancel(id);offers.remove(id);note="Transfer offer expired. Request a new transfer."}
        preview?.let { if(it.expiresAt<=now){inbox!!.dismiss(it.id);preview=null;note="Received preview expired. Request a new transfer."} }
    }
    private fun connection(id:String):Connection {ready();return connections[id]?.also { book!!.check(it.proof) } ?: error("This device is not securely connected. Local transport must be attached first.")}
    private fun snapshot():JSONObject {
        val state=identity.status();if(state.getString("status")=="ready"){ready();expire()}else closeAll()
        val peers=if(state.getString("status")=="ready")book!!.listPeers().map { p -> JSONObject().put("id",p.id).put("platform",p.platform).put("label",p.label).put("revoked",p.revoked).put("enrolledAt",p.enrolledAt).put("revokedAt",p.revokedAt ?: JSONObject.NULL).put("connected",connections.containsKey(p.id)).put("canOffer",connections[p.id]?.let { it.challenge!=null&&it.challengeExpires>identity.now() } ?: false) } else emptyList()
        return JSONObject().put("identity",state).put("transport","isolated").put("invitation",invitation ?: JSONObject.NULL).put("opened",opened ?: JSONObject.NULL)
            .put("pairings",JSONArray(pending.values.map { p -> JSONObject().put("id",p.id).put("fingerprint",p.peerId).put("platform",p.platform).put("verified",true).put("expiresAt",p.expiresAt) }))
            .put("peers",JSONArray(peers)).put("offers",JSONArray(offers.values.map { o -> JSONObject().put("id",o.id).put("peerId",o.peerId).put("bytes",o.bytes).put("sha256",o.sha256).put("expiresAt",o.expiresAt) }))
            .put("preview",preview?.let { JSONObject().put("id",it.id).put("peerId",it.peerId).put("expiresAt",it.expiresAt).put("value",it.value) } ?: JSONObject.NULL)
            .put("sources",RoutineInterchange.list(context).getJSONArray("choices")).put("note",note)
    }
    private fun disconnected(c:Connection){var active=false;if(pending[c.id]===c){pending.remove(c.id);active=true};if(connections[c.peerId]===c){connections.remove(c.peerId);active=true};for((id,o)in offers.toMap())if(o.peerId==c.peerId){offers.remove(id);inbox?.endpoint?.cancel(id)};if(active)note="Secure connection closed. A fresh connection and transfer confirmation are required."}
    private fun connected(c:Connection){connections[c.peerId]=c;c.socket.soTimeout=125000;readers.execute {
        try {while(!c.socket.isClosed){val bytes=RoutineHandoff.readFrame(c.socket.inputStream);authority.submit { receiveFrame(c,bytes) }.get()}}catch(_:Exception){try{c.socket.close()}catch(_:Exception){};authority.execute { disconnected(c) }}
    };note="Authenticated device connected. Transfers still require recipient acceptance and local import confirmation."}
    private fun receiveFrame(c:Connection,bytes:ByteArray){ready();book!!.check(c.proof);val f=inbox!!.endpoint.inspect(c.proof,bytes)
        when(f.type){
            0->{c.challenge=bytes;c.challengeExpires=f.expires;note="The connected device is ready to receive. Select routines and offer them explicitly."}
            1->{val offer=inbox!!.endpoint.receiveOffer(c.proof,bytes);offers[offer.sessionId]=Incoming(offer.sessionId,c.peerId,offer.bytes,offer.sha256,offer.expiresAt);note="A routine offer is waiting for your acceptance."}
            2->{c.socket.outputStream.write(inbox!!.endpoint.document(c.proof,bytes));c.socket.outputStream.flush();note="Routine sent for recipient preview. Nothing was activated."}
            3->{val result=inbox!!.receive(c.proof,bytes);preview=Preview(result.getString("sessionId"),c.peerId,f.expires,result.getJSONObject("preview"));offers.remove(f.id);note="Review the received routine. Saving creates inactive intent only."}
        }
    }
    /** Main-process transport integration only; never exposed by the WebView. */
    fun attach(socket:SSLSocket,link:String):Future<String> = authority.submit<String> {
        try {ready();val invite=RoutineHandoff.parseInvitation(link,identity.now());val proof=RoutineHandoff.Peer.authenticate(socket,currentId!!,invite.id);val history=identity.readTrust(currentId!!).getJSONArray("used")
            require((0 until history.length()).none { val r=history.getJSONObject(it);r.getString("key")==invite.id+":"+invite.nonce&&r.getLong("expires")>identity.now() }) { "This invitation has already been used. Generate a new one." }
            require(!connections.containsKey(invite.id)&&pending.values.none { it.peerId==invite.id }) { "A connection for this device already exists. Close it before retrying." };require(pending.size+connections.size<8)
            val c=Connection(UUID.randomUUID().toString(),invite.id,invite.platform,invite.expires,proof,socket,link)
            if(book!!.listPeers().any { it.id==invite.id&&!it.revoked }){book!!.connect(link,proof);connected(c)}else{pending[c.id]=c;note="Peer certificate verified. Compare the full fingerprint and approve or reject enrollment."};c.id
        }catch(e:Exception){try{socket.close()}catch(_:Exception){};throw e}
    }
    fun identityForTransport():HandoffIdentity=identity
    fun handle(action:String,args:JSONObject,reply:(JSONObject)->Unit){authority.execute { reply(process(action,args)) }}
    fun invokeForLocalTest(action:String,args:JSONObject=JSONObject()):Future<JSONObject> = authority.submit<JSONObject>{process(action,args)}
    private fun process(action:String,args:JSONObject):JSONObject=try {
        if(action!="status"){
            if(action=="setup"||action=="replace"){closeAll();identity.initialize(args.optBoolean("confirmed"),action=="replace",args.optString("expectedFingerprint").ifEmpty { null });currentId=null;ready();note="Device identity ready. Other devices must explicitly enroll this identity."}
            else {ready();expire();when(action){
                "invite"->{val link=RoutineHandoff.invitation(currentId!!,"android",identity.now());val parsed=RoutineHandoff.parseInvitation(link,identity.now());val bits=QRCodeWriter().encode(link,BarcodeFormat.QR_CODE,480,480);val bitmap=Bitmap.createBitmap(480,480,Bitmap.Config.ARGB_8888);for(y in 0 until 480)for(x in 0 until 480)bitmap.setPixel(x,y,if(bits[x,y])android.graphics.Color.BLACK else android.graphics.Color.WHITE);val out=ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,out);bitmap.recycle();invitation=JSONObject().put("link",link).put("expiresAt",parsed.expires).put("qr","data:image/png;base64,"+Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP));note="Invitation expires in two minutes. It contains public identity only."}
                "open"->{val p=RoutineHandoff.parseInvitation(args.getString("link"),identity.now());val used=identity.readTrust(currentId!!).getJSONArray("used");require((0 until used.length()).none { val r=used.getJSONObject(it);r.getString("key")==p.id+":"+p.nonce&&r.getLong("expires")>identity.now() }) { "This invitation has already been used. Generate a new one." };opened=JSONObject().put("fingerprint",p.id).put("platform",p.platform).put("expiresAt",p.expires).put("verified",false);note="Invitation opened. Approval remains unavailable until a secure connection proves this fingerprint."}
                "approve"->{val c=pending[args.getString("id")] ?: error("Pairing invitation expired or disconnected.");require(c.expiresAt>identity.now());book!!.enroll(c.link,c.proof,args.getString("fingerprint"),args.optString("label").ifEmpty { null },args.optString("replaceId").ifEmpty { null });pending.remove(c.id);connected(c)}
                "reject"->{pending.remove(args.getString("id"))?.socket?.close();note="Pairing rejected. No device was enrolled."}
                "revoke"->{val id=args.getString("id");book!!.revoke(id);connections[id]?.socket?.close();note="Device revoked. Existing and pending imports from this identity are blocked."}
                "receive"->{val c=connection(args.getString("peerId"));c.socket.outputStream.write(inbox!!.endpoint.request(c.proof));c.socket.outputStream.flush();note="Ready to receive from this device. You must still accept any offer."}
                "offer"->{val c=connection(args.getString("peerId"));require(c.challenge!=null&&c.challengeExpires>identity.now()) { "The recipient must request a fresh transfer first." };val text=RoutineInterchange.export(context,args.getJSONArray("selection")).toString();c.socket.outputStream.write(inbox!!.endpoint.offer(c.proof,text,c.challenge!!));c.socket.outputStream.flush();c.challenge=null;note="Offer sent. Waiting for the recipient to accept."}
                "accept"->{val o=offers[args.getString("id")] ?: error("This offer expired or disconnected.");require(args.optBoolean("confirmed")) { "Explicitly accept this offer for preview." };val c=connection(o.peerId);c.socket.outputStream.write(inbox!!.endpoint.accept(c.proof,o.id,c.peerId));c.socket.outputStream.flush();offers.remove(o.id);note="Offer accepted for preview only. Nothing will be saved or activated automatically."}
                "rejectOffer"->{offers.remove(args.getString("id"))?.let { inbox!!.endpoint.cancel(it.id);connections[it.peerId]?.socket?.close() };note="Offer rejected. Nothing was imported."}
                "save"->{val p=preview;require(p!=null&&p.id==args.getString("id")) { "Open a current received preview first." };inbox!!.save(p.id,args.optBoolean("confirmed"),args.optString("policy","reject"));preview=null;note="Saved inactive routine intent. Review adoption separately in Routine files."}
                "dismiss"->{preview?.let { inbox!!.dismiss(it.id) };preview=null;note="Received preview dismissed. Nothing was imported."}
                else->error("Unsupported pairing action.")
            }}
        }
        JSONObject().put("ok",true).put("result",snapshot())
    }catch(e:Exception){val message=e.message?:"";JSONObject().put("ok",false).put("error",if(Regex("^(Device |Create |Confirm |An identity |Could not |Pairing |This |Invalid |Expired |Unsupported |Unknown |Owner |Recipient |Replayed |Select |Use |Choose |Explicitly |The recipient |Open |Identity |Routine |Expected |Conflicting |Keep ).*").matches(message))message else "Pairing could not complete. No authority was granted.")}
    companion object {
        @Volatile private var instance:HandoffController?=null
        fun get(context:Context):HandoffController=instance ?: synchronized(this){instance ?: HandoffController(context).also { instance=it }}
    }
}
