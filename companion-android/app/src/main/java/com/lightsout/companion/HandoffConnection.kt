package com.lightsout.companion

import org.json.JSONObject
import android.util.Base64
import java.net.InetSocketAddress
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.interfaces.ECPublicKey
import java.security.AlgorithmParameters
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.TrustManagerFactory

/** Explicit foreground connection only. No discovery, listener or reconnect. */
object HandoffConnection {
    private const val FORMAT="lights-out.pairing"
    data class Details(val invitation:String,val certificate:X509Certificate,val host:String?,val port:Int?,val peer:RoutineHandoff.Invite)
    fun privateAddress(host:String):Boolean {
        val parts=host.split('.');if(parts.size!=4||parts.any { !it.matches(Regex("0|[1-9][0-9]{0,2}"))||it.toInt()>255 })return false
        val p=parts.map(String::toInt)
        return host=="127.0.0.1"||p[0]==10||p[0]==172&&p[1] in 16..31||p[0]==192&&p[1]==168
    }
    fun parse(text:String,now:Long):Details {
        require(text.toByteArray(Charsets.UTF_8).size<=8192) { "Invalid pairing details size." }
        val c=JSONObject(text)
        require(c.toString().replace("\\/","/")==text.replace("\\/","/")&&c.keys().asSequence().toSet()==setOf("format","version","invitation","certificate","host","port")&&c.getString("format")==FORMAT&&c.get("version")==1) { "Unsupported pairing details." }
        val peer=RoutineHandoff.parseInvitation(c.getString("invitation"),now)
        val encoded=c.getString("certificate");require(encoded.length<=4096&&encoded.matches(Regex("[A-Za-z0-9+/]+={0,2}")))
        val der=Base64.decode(encoded,Base64.NO_WRAP);require(Base64.encodeToString(der,Base64.NO_WRAP)==encoded)
        val cert=CertificateFactory.getInstance("X.509").generateCertificate(der.inputStream()) as X509Certificate
        require(cert.encoded.contentEquals(der)&&RoutineHandoff.fingerprint(der)==peer.id) { "Invalid pairing certificate identity." };cert.checkValidity(java.util.Date(now))
        val key=cert.publicKey as? ECPublicKey ?: error("Unsupported pairing certificate key.")
        val p256=AlgorithmParameters.getInstance("EC").apply{init(ECGenParameterSpec("secp256r1"))}.getParameterSpec(ECParameterSpec::class.java)
        require(key.params.order==p256.order&&key.params.curve==p256.curve&&key.params.generator==p256.generator&&key.params.cofactor==p256.cofactor);cert.verify(key)
        val host=if(c.isNull("host"))null else c.getString("host");val port=if(c.isNull("port"))null else c.get("port") as? Int ?: error("Invalid pairing port.")
        require(host==null&&port==null||host!=null&&privateAddress(host)&&port!=null&&port in 1024..65535) { "Invalid pairing endpoint. Use a private IPv4 address." }
        return Details(c.getString("invitation"),cert,host,port,peer)
    }
    fun card(identity:HandoffIdentity,invitation:String):String=JSONObject().put("format",FORMAT).put("version",1).put("invitation",invitation)
        .put("certificate",Base64.encodeToString(identity.publicCertificate().encoded,Base64.NO_WRAP)).put("host",JSONObject.NULL).put("port",JSONObject.NULL).toString()
    fun connect(identity:HandoffIdentity,text:String,confirmed:Boolean):Pair<SSLSocket,String> {
        require(confirmed) { "Confirm connecting to this PC for routine transfer." }
        val d=parse(text,identity.now());require(d.peer.platform=="windows"&&d.host!=null&&d.port!=null) { "Choose PC connection details from an open pairing window." }
        // Platform certificate validation plus an exact leaf pin. No trust-all
        // manager, hostname/DNS discovery or exported Android private key.
        val anchors=KeyStore.getInstance(KeyStore.getDefaultType()).apply{load(null);setCertificateEntry("expected-peer",d.certificate)}
        val trust=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply{init(anchors)}
        val tls=SSLContext.getInstance("TLS").apply{init(arrayOf(identity.keyManager()),trust.trustManagers,null)}
        val socket=tls.socketFactory.createSocket() as SSLSocket
        var stage="TLS configuration"
        try {
            socket.enabledProtocols=socket.supportedProtocols.filter { it in setOf("TLSv1.2","TLSv1.3") }.toTypedArray()
            socket.enabledCipherSuites=socket.supportedCipherSuites.filter { it.matches(Regex("TLS_(AES_(128|256)_GCM_SHA(256|384)|CHACHA20_POLY1305_SHA256|ECDHE_ECDSA_WITH_AES_(128|256)_GCM_SHA(256|384))")) }.toTypedArray()
            socket.soTimeout=8000;stage="TCP connection";socket.connect(InetSocketAddress(d.host,d.port),8000);stage="TLS handshake";socket.startHandshake();stage="certificate identity"
            RoutineHandoff.Peer.authenticate(socket,identity.status().getString("fingerprint"),d.peer.id)
            return socket to d.invitation
        }catch(e:Exception){try{socket.close()}catch(_:Exception){};val classes=generateSequence(e as Throwable?){it.cause}.take(4).joinToString("/"){it.javaClass.simpleName};val reason=Regex("(?:SSL|CERTIFICATE|SIGNATURE|KEY|ERR)_[A-Z0-9_]+").find(e.message?:"")?.value?:"";throw IllegalStateException("Could not connect securely at $stage ($classes${if(reason.isEmpty())"" else ": $reason"}). Generate new pairing details and try again.",e)}
    }
}
