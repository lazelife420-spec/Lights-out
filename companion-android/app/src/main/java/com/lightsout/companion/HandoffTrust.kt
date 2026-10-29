package com.lightsout.companion

import org.json.JSONArray
import org.json.JSONObject

object HandoffTrust {
    class Clock(private val wall:()->Long=System::currentTimeMillis,private val elapsed:()->Long={System.nanoTime()/1000000}) {
        private val startWall=wall();private val startElapsed=elapsed();private var highest=startWall
        fun now(floor:Long=0):Long { val raw=wall();require(raw+5000>=floor) { "Device clock moved backwards. Correct the clock before pairing." };highest=maxOf(highest,raw,startWall+elapsed()-startElapsed,floor);return highest }
    }
    fun strictTime(j:JSONObject,key:String):Long {val v=j.get(key);require(v is Int||v is Long){"Pairing storage contains an ambiguous timestamp."};val n=(v as Number).toLong();require(n in 1..9007199254740991L);return n}
    fun empty(id:String)=JSONObject().put("version",1).put("localId",id).put("peers",JSONArray()).put("used",JSONArray()).put("sessions",JSONArray())
    private fun fields(j:JSONObject,names:Set<String>){require(j.keys().asSequence().toSet()==names){"Pairing storage has unsupported or missing fields."}}
    fun validate(j:JSONObject,id:String):JSONObject {
        fields(j,setOf("version","localId","peers","used","sessions"));require(j.get("version")==1&&j.getString("localId")==id&&id.matches(Regex("[a-f0-9]{64}"))) { "Device identity changed; re-enrollment is required." }
        val peers=j.getJSONArray("peers");require(peers.length()<=64);val ids=mutableSetOf<String>()
        for(n in 0 until peers.length()) { val p=peers.getJSONObject(n);fields(p,setOf("id","platform","revoked","label","enrolledAt","revokedAt"));val peer=p.getString("id");val label=p.getString("label");val at=strictTime(p,"enrolledAt")
            require(peer.matches(Regex("[a-f0-9]{64}"))&&peer!=id&&ids.add(peer)&&p.getString("platform") in setOf("windows","android")&&p.get("revoked") is Boolean&&label.isNotBlank()&&label==label.trim()&&label.length<=60&&label.none { it.code<32||it.code==127 }&&at>0&&p.getBoolean("revoked")==!p.isNull("revokedAt")&&(p.isNull("revokedAt")||strictTime(p,"revokedAt")>=at)) { "Pairing storage has an invalid device." }
        }
        for(key in listOf("used","sessions")){val a=j.getJSONArray(key);require(a.length()<=128);val seen=mutableSetOf<String>();for(n in 0 until a.length()){val r=a.getJSONObject(n);fields(r,setOf("key","expires"));val value=r.getString("key");require(value.matches(Regex(if(key=="used")"[a-f0-9]{64}:[a-f0-9]{32}" else "[a-f0-9]{32}"))&&seen.add(value)&&strictTime(r,"expires")>0) { "Pairing replay storage is invalid." }}}
        return JSONObject(j.toString())
    }
    fun storage(identity:HandoffIdentity,localId:String)=object:RoutineHandoff.Storage {
        override fun read():RoutineHandoff.Snapshot {
            val s=validate(identity.readTrust(localId),localId);val a=s.getJSONArray("peers")
            val peers=(0 until a.length()).map { n -> val p=a.getJSONObject(n);RoutineHandoff.KnownPeer(p.getString("id"),p.getString("platform"),p.getBoolean("revoked"),p.getString("label"),p.getLong("enrolledAt"),if(p.isNull("revokedAt"))null else p.getLong("revokedAt")) }
            fun history(key:String):Map<String,Long>{val rows=s.getJSONArray(key);return (0 until rows.length()).associate { val r=rows.getJSONObject(it);r.getString("key") to r.getLong("expires") }}
            return RoutineHandoff.Snapshot(peers,history("used"),history("sessions"))
        }
        override fun write(snapshot:RoutineHandoff.Snapshot){
            val s=empty(localId);s.put("peers",JSONArray(snapshot.peers.map { p -> JSONObject().put("id",p.id).put("platform",p.platform).put("revoked",p.revoked).put("label",p.label).put("enrolledAt",p.enrolledAt).put("revokedAt",p.revokedAt ?: JSONObject.NULL) }))
            for((key,rows)in listOf("used" to snapshot.used,"sessions" to snapshot.sessions))s.put(key,JSONArray(rows.map { (k,e) -> JSONObject().put("key",k).put("expires",e) }))
            identity.writeTrust(localId,validate(s,localId))
        }
    }
}
