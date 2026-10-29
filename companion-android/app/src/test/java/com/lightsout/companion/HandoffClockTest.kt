package com.lightsout.companion

import org.junit.Assert.*
import org.junit.Test

class HandoffClockTest {
    @Test fun invitationAllowsBoundedClockSkewWithoutAcceptingExpiredLinks(){
        val now=1792210000000L;val link=RoutineHandoff.invitation("01".repeat(32),"windows",now)
        assertEquals(now+RoutineHandoff.TTL,RoutineHandoff.parseInvitation(link,now-5000).expires)
        assertThrows(IllegalArgumentException::class.java){RoutineHandoff.parseInvitation(link,now-5001)}
        assertThrows(IllegalArgumentException::class.java){RoutineHandoff.parseInvitation(link,now+RoutineHandoff.TTL)}
    }
    @Test fun monotonicElapsedPreventsBackwardsClockExtendingInvitation(){
        var wall=1000000L;var elapsed=100L
        val clock=HandoffTrust.Clock({wall},{elapsed})
        elapsed+=120001;wall-=60000
        assertEquals(1120001L,clock.now())
        wall=1000000L;assertEquals(1120001L,clock.now())
    }
    @Test fun restartBehindSealedTimestampFailsClosed(){
        val clock=HandoffTrust.Clock({1000000L},{100L})
        assertThrows(IllegalArgumentException::class.java){clock.now(1005001L)}
    }
    @Test fun ForwardClockNeverRewindsWithinProcess(){
        var wall=1000000L;val clock=HandoffTrust.Clock({wall},{0L})
        wall=2000000L;assertEquals(wall,clock.now());wall=1000000L
        assertEquals(2000000L,clock.now())
    }
}
