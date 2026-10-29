package com.lightsout.companion

import java.io.File
import java.net.InetSocketAddress
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager

/** Isolated QA executable, not packaged application code. Synthetic keys only. */
object RoutineHandoffInterop {
    @JvmStatic fun main(args: Array<String>) {
        val root=File(args[0]).canonicalFile;require(root.name.matches(Regex("lightsout-sdh-test-[A-Za-z0-9]+")))
        val port=args[1].toInt();require(port in 1024..65535)
        val certs=CertificateFactory.getInstance("X.509")
        val local=File(root,"android.cert.pem").inputStream().use { certs.generateCertificate(it) as X509Certificate }
        val remote=File(root,"windows.cert.pem").inputStream().use { certs.generateCertificate(it) as X509Certificate }
        val localId=RoutineHandoff.fingerprint(local.encoded);val remoteId=RoutineHandoff.fingerprint(remote.encoded)
        val keys=KeyStore.getInstance("PKCS12");File(root,"android.p12").inputStream().use { keys.load(it,"local-qa-only".toCharArray()) }
        val km=KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());km.init(keys,"local-qa-only".toCharArray())
        val trust=object:X509TrustManager {
            override fun getAcceptedIssuers()=arrayOf(remote)
            override fun checkClientTrusted(chain:Array<X509Certificate>,authType:String)=checkServerTrusted(chain,authType)
            override fun checkServerTrusted(chain:Array<X509Certificate>,authType:String){require(chain.isNotEmpty()&&RoutineHandoff.fingerprint(chain[0].encoded)==remoteId);chain[0].checkValidity()}
        }
        val context=SSLContext.getInstance("TLS");context.init(km.keyManagers,arrayOf(trust),null)
        (context.socketFactory.createSocket() as SSLSocket).use { socket ->
            socket.enabledProtocols=arrayOf("TLSv1.3");socket.connect(InetSocketAddress("127.0.0.1",port),10000)
            val peer=RoutineHandoff.Peer.authenticate(socket,localId,remoteId)
            val book=RoutineHandoff.Book(localId,"android");book.enroll(args[2],peer,remoteId)
            val document=File(args[3]).readText();var previews=0
            val endpoint=RoutineHandoff.Endpoint(book,{require(it==document)},{previews++;"inactive-preview"})
            val output=socket.outputStream;val input=socket.inputStream
            output.write(endpoint.request(peer));output.flush()
            val offer=endpoint.receiveOffer(peer,RoutineHandoff.readFrame(input));check(previews==0)
            output.write(endpoint.accept(peer,offer.sessionId,remoteId));output.flush()
            val received=endpoint.receiveDocument(peer,RoutineHandoff.readFrame(input));check(received.document==document&&previews==1)
            val challenge=RoutineHandoff.readFrame(input);output.write(endpoint.offer(peer,document,challenge));output.flush()
            output.write(endpoint.document(peer,RoutineHandoff.readFrame(input)));output.flush()
            println("PASS native Kotlin/JCA mutual TLS: Windows -> Android-compatible preview; reverse offer delivered; previews=$previews; protocol=${socket.session.protocol}")
        }
    }
}
