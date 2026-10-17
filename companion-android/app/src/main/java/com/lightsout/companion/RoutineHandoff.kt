package com.lightsout.companion

import java.io.DataInputStream
import java.io.InputStream
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.SSLSocket

/** Protocol foundation only: no listeners, discovery, identity storage or actions. */
object RoutineHandoff {
    const val MAX_BYTES = 262144
    const val HEADER = 150
    const val TTL = 120000L
    private val magic = "LOSDH001".toByteArray(Charsets.US_ASCII)
    private val random = SecureRandom()
    private val platforms = mapOf("windows" to 1, "android" to 2)
    fun fingerprint(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).hex()
    private fun ByteArray.hex() = joinToString("") { "%02x".format(it.toInt() and 255) }
    private fun String.bytes() = chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun id(value: String) = value.matches(Regex("[a-f0-9]{64}"))
    private fun nonce() = ByteArray(16).also(random::nextBytes).hex()

    class Peer private constructor(val localId: String, val peerId: String, private val socket: SSLSocket) {
        fun verify() {
            require(!socket.isClosed && socket.isConnected) { "Authenticated open TLS channel required." }
            val session = socket.session
            require(session.protocol in setOf("TLSv1.2", "TLSv1.3")) { "Unsupported TLS version." }
            require(session.cipherSuite.matches(Regex("TLS_(AES_(128|256)_GCM_SHA(256|384)|CHACHA20_POLY1305_SHA256|ECDHE_ECDSA_WITH_AES_(128|256)_GCM_SHA(256|384))"))) { "Modern authenticated TLS cipher required." }
            val local = session.localCertificates?.firstOrNull() as? X509Certificate
            val remote = session.peerCertificates.firstOrNull() as? X509Certificate
            require(local != null && remote != null) { "Mutual TLS certificates required." }
            local.checkValidity(); remote.checkValidity()
            require(fingerprint(local.encoded) == localId && fingerprint(remote.encoded) == peerId) { "TLS certificate identity mismatch." }
        }
        companion object {
            fun authenticate(socket: SSLSocket, localId: String, peerId: String): Peer {
                require(id(localId) && id(peerId) && localId != peerId)
                socket.soTimeout = 10000
                socket.startHandshake()
                return Peer(localId, peerId, socket).also { it.verify() }
            }
        }
    }
    data class Invite(val id: String, val platform: String, val nonce: String, val expires: Long)
    fun invitation(id: String, platform: String, now: Long = System.currentTimeMillis()): String {
        require(id(id) && platform in platforms)
        return "lightsout-handoff://enroll/v1?fingerprint=$id&platform=$platform&nonce=${nonce()}&expires=${now+TTL}"
    }
    fun parseInvitation(link: String, now: Long = System.currentTimeMillis()): Invite {
        require(link.length <= 400)
        val u = URI(link)
        require(u.scheme == "lightsout-handoff" && u.host == "enroll" && u.path == "/v1" && u.userInfo == null && u.port == -1 && u.fragment == null) { "Invalid enrollment link." }
        val entries = (u.rawQuery ?: "").split('&').map { it.split('=', limit = 2).also { v -> require(v.size == 2) } }
        require(entries.map { it[0] }.sorted() == listOf("expires", "fingerprint", "nonce", "platform")) { "Ambiguous enrollment link." }
        val p = entries.associate { it[0] to it[1] }
        val key = p.getValue("fingerprint"); val platform = p.getValue("platform"); val nonce = p.getValue("nonce"); val expiry = p.getValue("expires")
        require(id(key) && platform in platforms && nonce.matches(Regex("[a-f0-9]{32}")) && expiry.matches(Regex("[0-9]{13}")))
        val expires = expiry.toLong(); require(expires > now && expires <= now+TTL) { "Expired enrollment link." }
        return Invite(key, platform, nonce, expires)
    }
    data class KnownPeer(val id: String, val platform: String, var revoked: Boolean = false)
    class Book(val id: String, val platform: String, val clock: () -> Long = System::currentTimeMillis) {
        init { require(id(id) && platform in platforms) }
        private val peers = mutableMapOf<String, KnownPeer>()
        private val used = mutableMapOf<String, Long>()
        fun check(peer: Peer): KnownPeer {
            require(peer.localId == id); peer.verify()
            return peers[peer.peerId]?.also { require(!it.revoked) { "Revoked peer." } } ?: error("Unknown peer.")
        }
        fun enroll(link: String, peer: Peer, confirmedFingerprint: String): KnownPeer {
            val invite = parseInvitation(link, clock()); require(peer.localId == id); peer.verify()
            require(invite.id == peer.peerId && invite.id == confirmedFingerprint) { "Owner must confirm the authenticated fingerprint." }
            used.entries.removeAll { it.value <= clock() }; val key = invite.id+":"+invite.nonce
            require(key !in used && used.size < 128) { "Replayed enrollment or enrollment limit." }; used[key] = invite.expires
            val known = KnownPeer(invite.id, invite.platform); peers[invite.id] = known; return known.copy()
        }
        fun revoke(id: String) { require(id(id)); peers[id]?.revoked = true }
    }
    data class Frame(val type: Int, val platform: String, val id: String, val sender: String, val recipient: String,
        val issued: Long, val expires: Long, val length: Int, val digest: String, val body: ByteArray = byteArrayOf())
    fun encode(f: Frame): ByteArray = ByteBuffer.allocate(HEADER+f.body.size).apply {
        put(magic); put(f.type.toByte()); put(platforms.getValue(f.platform).toByte()); putShort(1); putShort(1)
        put(f.id.bytes()); put(f.sender.bytes()); put(f.recipient.bytes()); putLong(f.issued); putLong(f.expires); putInt(f.length); put(f.digest.bytes()); putInt(f.body.size); put(f.body)
    }.array()
    fun decode(bytes: ByteArray): Frame {
        require(bytes.size in HEADER..HEADER+MAX_BYTES) { "Bounded complete handoff frame required." }
        val b = ByteBuffer.wrap(bytes)
        fun take(n: Int) = ByteArray(n).also { b.get(it) }
        require(take(8).contentEquals(magic)) { "Unknown handoff protocol." }
        val type = b.get().toInt(); val platform = platforms.entries.firstOrNull { it.value == b.get(b.position()).toInt() }?.key
        b.get(); require(type in 0..3 && platform != null && b.short.toInt() == 1 && b.short.toInt() == 1) { "Unsupported protocol or schema capability." }
        val sid = take(16).hex(); val sender = take(32).hex(); val recipient = take(32).hex(); val issued = b.long; val expires = b.long; val length = b.int; val digest = take(32).hex(); val size = b.int
        require(issued in 0..9007199254740991L && expires in 0..9007199254740991L && length in 1..MAX_BYTES && size == bytes.size-HEADER && if(type == 3) size == length else size == 0) { "Malformed handoff frame." }
        require(type != 0 || (length == 1 && digest == "0".repeat(64))) { "Malformed session challenge." }
        return Frame(type, platform, sid, sender, recipient, issued, expires, length, digest, take(size))
    }
    fun readFrame(input: InputStream): ByteArray {
        val stream = DataInputStream(input); val header = ByteArray(HEADER); stream.readFully(header)
        val size = ByteBuffer.wrap(header).getInt(146); require(size in 0..MAX_BYTES) { "Handoff payload exceeds limit." }
        return (header+ByteArray(size).also(stream::readFully)).also { decode(it) }
    }
    data class Offer(val sessionId: String, val peerId: String, val bytes: Int, val sha256: String, val expiresAt: Long)
    data class Delivery(val sessionId: String, val document: String, val preview: Any, val expiresAt: Long)
    class Endpoint(private val book: Book, private val validate: (String) -> Unit, private val preview: (String) -> Any) {
        private data class Pending(val peer: Peer, val offer: Frame, val outgoing: Boolean, val body: ByteArray = byteArrayOf(), var accepted: Boolean = false, val awaiting: Boolean = false)
        private val pending = mutableMapOf<String, Pending>(); private val seen = mutableMapOf<String, Long>()
        private fun prune() { val now=book.clock(); pending.entries.removeAll { it.value.offer.expires <= now }; seen.entries.removeAll { it.value <= now } }
        private fun live(peer: Peer, frame: Frame) {
            val known=book.check(peer); val now=book.clock()
            require(frame.sender == known.id && frame.recipient == book.id && frame.platform == known.platform) { "Wrong peer or recipient." }
            require(frame.issued <= now+5000 && frame.expires > now && frame.expires-frame.issued in 1000..TTL && frame.expires <= now+TTL+5000) { "Expired or invalid transfer session." }
        }
        private fun reserve(id: String, expires: Long) { prune(); require(id !in seen && pending.size < 8 && seen.size < 128) { "Replayed session or transfer limit." }; seen[id]=expires }
        fun request(peer: Peer): ByteArray {
            book.check(peer);val now=book.clock();val f=Frame(0,book.platform,nonce(),book.id,peer.peerId,now,now+TTL,1,"0".repeat(64))
            reserve(f.id,f.expires);pending[f.id]=Pending(peer,f,false,awaiting=true);return encode(f)
        }
        fun offer(peer: Peer, text: String, challenge: ByteArray): ByteArray {
            book.check(peer); val body=text.toByteArray(Charsets.UTF_8); require(body.size <= MAX_BYTES); validate(text)
            val hello=decode(challenge);live(peer,hello);require(hello.type == 0) { "Fresh recipient challenge required." }
            val f=hello.copy(type=1,platform=book.platform,sender=book.id,recipient=peer.peerId,length=body.size,digest=fingerprint(body))
            reserve(f.id,f.expires);pending[f.id]=Pending(peer,f,true,body);return encode(f)
        }
        fun receiveOffer(peer: Peer, bytes: ByteArray): Offer {
            val f=decode(bytes);live(peer,f);require(f.type == 1);val s=state(peer,f.id,false);require(s.awaiting && s.offer.issued == f.issued && s.offer.expires == f.expires) { "Fresh recipient challenge required." };pending[f.id]=Pending(peer,f,false)
            return Offer(f.id,f.sender,f.length,f.digest,f.expires)
        }
        private fun state(peer: Peer,id: String,outgoing: Boolean): Pending { prune();book.check(peer);return pending[id]?.also { require(it.peer === peer && it.outgoing == outgoing) { "Wrong-channel session." } } ?: error("Unknown or interrupted session.") }
        fun accept(peer: Peer,id: String,confirmedFingerprint: String): ByteArray {
            val s=state(peer,id,false);require(!s.awaiting && !s.accepted && confirmedFingerprint == peer.peerId) { "Recipient confirmation required." };s.accepted=true
            return encode(s.offer.copy(type=2,platform=book.platform,sender=book.id,recipient=peer.peerId))
        }
        private fun match(s: Pending,f: Frame) { require(s.offer.id == f.id && s.offer.issued == f.issued && s.offer.expires == f.expires && s.offer.length == f.length && s.offer.digest == f.digest) { "Altered transfer offer." } }
        fun document(peer: Peer,bytes: ByteArray): ByteArray {
            val f=decode(bytes);live(peer,f);require(f.type == 2);val s=state(peer,f.id,true);match(s,f);pending.remove(f.id);return encode(s.offer.copy(type=3,body=s.body))
        }
        fun receiveDocument(peer: Peer,bytes: ByteArray): Delivery {
            val f=decode(bytes);live(peer,f);require(f.type == 3);val s=state(peer,f.id,false);require(s.accepted) { "Recipient acceptance required." };match(s,f);pending.remove(f.id)
            require(fingerprint(f.body) == f.digest) { "Altered routine payload." }
            val text=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(f.body)).toString()
            validate(text);return Delivery(f.id,text,preview(text),f.expires)
        }
        fun cancel(id: String) { pending.remove(id) }
    }
}
