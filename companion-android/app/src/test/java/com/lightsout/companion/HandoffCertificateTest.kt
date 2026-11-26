package com.lightsout.companion

import java.math.BigInteger
import java.security.KeyPairGenerator
import java.security.spec.ECGenParameterSpec
import java.security.cert.CertificateExpiredException
import java.util.Date
import org.junit.Assert.*
import org.junit.Test

class HandoffCertificateTest {
    private fun key()=KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    @Test fun exactSelfSignedAnchorWithBoundedUsageAndValidity(){
        val pair=key();val now=1792285200000L;val cert=HandoffCertificate.create(pair.public,pair.private,BigInteger.valueOf(128),now)
        cert.verify(pair.public);assertEquals(pair.public,cert.publicKey);assertEquals(cert.issuerX500Principal,cert.subjectX500Principal)
        assertEquals(3,cert.version);assertEquals(0,cert.basicConstraints);assertEquals("SHA256withECDSA",cert.sigAlgName);assertEquals(BigInteger.valueOf(128),cert.serialNumber)
        assertTrue(cert.keyUsage[0]);assertTrue(cert.keyUsage[5]);assertFalse(cert.keyUsage[6]);assertEquals(setOf("2.5.29.19","2.5.29.15"),cert.criticalExtensionOIDs)
        assertEquals(setOf("1.3.6.1.5.5.7.3.1","1.3.6.1.5.5.7.3.2"),cert.extendedKeyUsage.toSet())
        assertEquals(now-60000,cert.notBefore.time);assertEquals(now+365L*86400000,cert.notAfter.time)
        assertThrows(CertificateExpiredException::class.java){cert.checkValidity(Date(now+366L*86400000))}
        assertThrows(java.security.SignatureException::class.java){cert.verify(key().public)}
    }
    @Test fun generalizedTimeAndPositiveSerialRemainValidBeyond2049(){
        val pair=key();val now=java.time.Instant.parse("2104-02-29T12:00:00Z").toEpochMilli()
        val cert=HandoffCertificate.create(pair.public,pair.private,BigInteger.ONE.shiftLeft(127),now)
        cert.checkValidity(Date(now));assertEquals(now,cert.notBefore.time+60000);assertEquals(BigInteger.ONE.shiftLeft(127),cert.serialNumber)
    }
    @Test fun rejectsUnboundedOrInvalidTemplateInputs(){
        val pair=key()
        for(serial in listOf(BigInteger.ZERO,BigInteger.valueOf(-1),BigInteger.ONE.shiftLeft(128)))assertThrows(IllegalArgumentException::class.java){HandoffCertificate.create(pair.public,pair.private,serial,1792285200000L)}
        assertThrows(IllegalArgumentException::class.java){HandoffCertificate.create(pair.public,pair.private,BigInteger.ONE,Long.MAX_VALUE)}
    }
}
