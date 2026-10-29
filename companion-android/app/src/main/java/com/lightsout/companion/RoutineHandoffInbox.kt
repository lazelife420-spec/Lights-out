package com.lightsout.companion

import android.content.Context
import org.json.JSONObject

/** Called only by a future local review surface, never by a remote command. */
class RoutineHandoffInbox(private val context: Context, private val book: RoutineHandoff.Book) {
    val endpoint = RoutineHandoff.Endpoint(book, { RoutineInterchange.parse(it); Unit }, { RoutineInterchange.preview(context,it) })
    private data class Ready(val delivery: RoutineHandoff.Delivery,val peer: RoutineHandoff.Peer)
    private val ready = mutableMapOf<String,Ready>()
    fun receive(peer: RoutineHandoff.Peer,frame: ByteArray): JSONObject {
        require(ready.size < 8) { "Review or dismiss pending transfers first." }
        val result=endpoint.receiveDocument(peer,frame);ready[result.sessionId]=Ready(result,peer)
        return JSONObject().put("sessionId",result.sessionId).put("preview",result.preview)
    }
    fun save(sessionId: String,confirmed: Boolean,policy: String = "reject"): JSONObject {
        val r=ready[sessionId];require(r != null && confirmed) { "Confirm the received preview before importing." };book.check(r.peer)
        if(r.delivery.expiresAt <= book.clock()){ready.remove(sessionId);error("Received preview expired.")}
        val result=RoutineInterchange.importFile(context,r.delivery.document,policy);ready.remove(sessionId);return result
    }
    fun dismiss(sessionId: String) { ready.remove(sessionId);endpoint.cancel(sessionId) }
}
