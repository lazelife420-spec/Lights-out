package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream

class RoutineHandoffTest {
    private val now=1792210000000L
    private fun frame()=RoutineHandoff.Frame(1,"windows","ab".repeat(16),"01".repeat(32),"02".repeat(32),now,now+120000,2,RoutineHandoff.fingerprint("{}".toByteArray()))
    @Test fun roundTripUsesExactBoundedHeader() {
        val f=frame();val bytes=RoutineHandoff.encode(f);assertEquals(150,bytes.size);val decoded=RoutineHandoff.decode(bytes)
        assertEquals(f.id,decoded.id);assertEquals(f.sender,decoded.sender);assertEquals(f.expires,decoded.expires);assertEquals(f.digest,decoded.digest)
        assertArrayEquals(bytes,RoutineHandoff.readFrame(ByteArrayInputStream(bytes)))
    }
    @Test fun schemaCapabilityTypeAndPlatformCannotBeAmbiguous() {
        for(offset in listOf(8,9,10,12)){val b=RoutineHandoff.encode(frame());b[offset]=127;assertThrows(IllegalArgumentException::class.java){RoutineHandoff.decode(b)}}
    }
    @Test fun truncatedTrailingAndOversizedFramesFail() {
        val b=RoutineHandoff.encode(frame());assertThrows(IllegalArgumentException::class.java){RoutineHandoff.decode(b.copyOf(149))}
        assertThrows(IllegalArgumentException::class.java){RoutineHandoff.decode(b+byteArrayOf(0))}
        java.nio.ByteBuffer.wrap(b).putInt(146,Int.MAX_VALUE);assertThrows(IllegalArgumentException::class.java){RoutineHandoff.readFrame(ByteArrayInputStream(b))}
    }
    @Test fun payloadIsBoundToItsExactLength() {
        val f=frame().copy(type=3,body="{}".toByteArray());assertEquals(152,RoutineHandoff.encode(f).size)
        assertEquals("{}",String(RoutineHandoff.decode(RoutineHandoff.encode(f)).body))
        assertThrows(IllegalArgumentException::class.java){RoutineHandoff.decode(RoutineHandoff.encode(f.copy(length=3)))}
    }
    @Test fun enrollmentLinksArePublicBoundedFreshAndUnambiguous() {
        val key="01".repeat(32);val link=RoutineHandoff.invitation(key,"windows",now)
        assertEquals(key,RoutineHandoff.parseInvitation(link,now).id)
        assertThrows(IllegalArgumentException::class.java){RoutineHandoff.parseInvitation(link+"&nonce=bad",now)}
        assertThrows(IllegalArgumentException::class.java){RoutineHandoff.parseInvitation(link,now+120001)}
        assertThrows(IllegalArgumentException::class.java){RoutineHandoff.parseInvitation(link.replace("/v1","/v2"),now)}
    }
    @Test fun malformedChallengesCannotCreateTransferAuthority() {
        val f=frame().copy(type=0,length=1,digest="0".repeat(64));assertEquals(0,RoutineHandoff.decode(RoutineHandoff.encode(f)).type)
        assertThrows(IllegalArgumentException::class.java){RoutineHandoff.decode(RoutineHandoff.encode(f.copy(length=2)))}
    }
    @Test fun primitiveFingerprintMatchesStandardSha256Vector() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",RoutineHandoff.fingerprint("abc".toByteArray()))
    }
}
