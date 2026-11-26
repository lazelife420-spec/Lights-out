package com.lightsout.companion

import java.math.BigInteger
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.security.auth.x500.X500Principal

/** Fixed X.509 template for this app's new P-256 identity, signed by its key handle.
 * BoringSSL requires certificate-signing usage on the exact self-signed anchor.
 * No key export, OS trust installation or certificate parser is implemented here.
 * Both transports still pin the exact leaf, so child certificates grant nothing.
 */
object HandoffCertificate {
    private fun hex(value:String)=value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    private fun der(tag:Int,bytes:ByteArray):ByteArray {
        require(bytes.size<=4096)
        val size=bytes.size
        val length=when { size<128->byteArrayOf(size.toByte());size<256->byteArrayOf(0x81.toByte(),size.toByte());else->byteArrayOf(0x82.toByte(),(size ushr 8).toByte(),size.toByte()) }
        return byteArrayOf(tag.toByte())+length+bytes
    }
    private fun sequence(vararg values:ByteArray)=der(0x30,values.fold(byteArrayOf()) { a,b->a+b })
    private fun time(value:Long):ByteArray {
        val utc=TimeZone.getTimeZone("UTC")
        val year=Calendar.getInstance(utc,Locale.US).apply { timeInMillis=value }.get(Calendar.YEAR)
        val short=year in 1950..2049
        val text=SimpleDateFormat(if(short)"yyMMddHHmmss'Z'" else "yyyyMMddHHmmss'Z'",Locale.US).apply { timeZone=utc }.format(Date(value))
        return der(if(short)0x17 else 0x18,text.toByteArray(Charsets.US_ASCII))
    }
    fun create(publicKey:PublicKey,privateKey:PrivateKey,serial:BigInteger,now:Long):X509Certificate {
        require(publicKey.algorithm=="EC"&&privateKey.algorithm=="EC"&&publicKey.encoded.size<=512&&serial.signum()>0&&serial.bitLength()<=128&&now>=60000&&now<=Long.MAX_VALUE-365L*86400000)
        val algorithm=hex("300a06082a8648ce3d040302") // ecdsa-with-SHA256, absent parameters
        val name=X500Principal("CN=Lights Out routine handoff").encoded
        val constraints=sequence(hex("0603551d13"),hex("0101ff"),der(0x04,sequence(hex("0101ff"),hex("020100"))))
        val usage=sequence(hex("0603551d0f"),hex("0101ff"),der(0x04,hex("03020284"))) // digitalSignature, keyCertSign
        val extended=sequence(hex("0603551d25"),der(0x04,sequence(hex("06082b06010505070301"),hex("06082b06010505070302"))))
        val tbs=sequence(hex("a003020102"),der(0x02,serial.toByteArray()),algorithm,name,sequence(time(now-60000),time(now+365L*86400000)),name,publicKey.encoded,der(0xa3,sequence(constraints,usage,extended)))
        val signer=Signature.getInstance("SHA256withECDSA");signer.initSign(privateKey);signer.update(tbs)
        val encoded=sequence(tbs,algorithm,der(0x03,byteArrayOf(0)+signer.sign()))
        val certificate=CertificateFactory.getInstance("X.509").generateCertificate(encoded.inputStream()) as X509Certificate
        certificate.verify(publicKey);certificate.checkValidity(Date(now))
        check(certificate.encoded.contentEquals(encoded)&&certificate.publicKey.encoded.contentEquals(publicKey.encoded)&&certificate.basicConstraints==0&&certificate.keyUsage[0]&&certificate.keyUsage[5])
        return certificate
    }
}
