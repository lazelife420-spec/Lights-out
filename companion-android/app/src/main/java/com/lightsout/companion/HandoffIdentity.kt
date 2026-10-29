package com.lightsout.companion

import android.content.Context
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.math.BigInteger
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import java.util.Date
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import javax.net.ssl.SSLEngine
import javax.net.ssl.X509ExtendedKeyManager
import javax.security.auth.x500.X500Principal

/** Only this app's new handoff aliases. Never accesses APK signing identities. */
class HandoffIdentity(context:Context,private val clock:HandoffTrust.Clock=HandoffTrust.Clock()) {
    private val directory=File(context.applicationContext.filesDir,"routine-handoff")
    private val anchor=File(directory,"anchor.json");private val sealed=File(directory,"protected.bin")
    private val keys=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val firstIdentity="lightsout.handoff.identity.v1";private val firstSeal="lightsout.handoff.registry.v1"
    private fun b64(bytes:ByteArray)=Base64.encodeToString(bytes,Base64.NO_WRAP)
    private fun atomic(file:File,bytes:ByteArray,verify:(ByteArray)->Unit){directory.mkdirs();val tmp=File(directory,file.name+"."+UUID.randomUUID()+".tmp");try{FileOutputStream(tmp).use { it.write(bytes);it.fd.sync() };verify(tmp.readBytes());Files.move(tmp.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)}finally{tmp.delete()}}
    private fun bounded(file:File,max:Long):ByteArray {require(file.length()<=max);return file.readBytes()}
    private fun marker():JSONObject { val raw=String(bounded(anchor,1024),Charsets.UTF_8);return JSONObject(raw).also { require(it.toString()==raw&&it.keys().asSequence().toSet()==setOf("version","installId","fingerprint","identityAlias","sealAlias")&&it.get("version")==1&&it.getString("installId").matches(Regex("[a-f0-9-]{36}"))&&it.getString("fingerprint").matches(Regex("[a-f0-9]{64}"))&&it.getString("identityAlias").matches(Regex("lightsout\\.handoff\\.identity\\.(v1|[a-f0-9-]{36})"))&&it.getString("sealAlias").matches(Regex("lightsout\\.handoff\\.registry\\.(v1|[a-f0-9-]{36})"))) } }
    private fun decrypt(bytes:ByteArray,m:JSONObject):String {
        val env=JSONObject(String(bytes,Charsets.UTF_8));require(env.keys().asSequence().toSet()==setOf("iv","ciphertext"))
        val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,keys.getKey(m.getString("sealAlias"),null) as SecretKey,GCMParameterSpec(128,Base64.decode(env.getString("iv"),Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(env.getString("ciphertext"),Base64.NO_WRAP)),Charsets.UTF_8)
    }
    private fun load():Pair<JSONObject,JSONObject> {
        try {
            check(anchor.exists()||sealed.exists()||keys.containsAlias(firstIdentity)||keys.containsAlias(firstSeal)) { "Create a device identity to begin pairing." }
            val m=marker();val raw=decrypt(bounded(sealed,262144),m);val r=JSONObject(raw);require(r.toString()==raw&&r.keys().asSequence().toSet()==setOf("version","installId","fingerprint","createdAt","lastWall","trust")&&r.get("version")==1&&HandoffTrust.strictTime(r,"createdAt")<=HandoffTrust.strictTime(r,"lastWall")&&r.getString("installId")==m.getString("installId")&&r.getString("fingerprint")==m.getString("fingerprint"))
            val alias=m.getString("identityAlias");require(alias.startsWith("lightsout.handoff.identity."));val cert=keys.getCertificate(alias) as X509Certificate;val key=keys.getKey(alias,null) as PrivateKey
            require(key.encoded==null&&RoutineHandoff.fingerprint(cert.encoded)==r.getString("fingerprint"));cert.checkValidity(Date(clock.now(r.getLong("lastWall"))))
            r.put("trust",HandoffTrust.validate(r.getJSONObject("trust"),r.getString("fingerprint")));return m to r
        }catch(e:Exception){if(e.message=="Create a device identity to begin pairing."||e.message?.startsWith("Device clock moved backwards.")==true)throw e;error("Device identity or trust storage is missing, replaced or corrupt. Explicit identity replacement and re-enrollment are required.")}
    }
    private fun write(m:JSONObject,r:JSONObject) {
        r.put("lastWall",clock.now(r.getLong("lastWall")));val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,keys.getKey(m.getString("sealAlias"),null) as SecretKey)
        val env=JSONObject().put("iv",b64(cipher.iv)).put("ciphertext",b64(cipher.doFinal(r.toString().toByteArray(Charsets.UTF_8)))).toString().toByteArray()
        try{atomic(sealed,env){require(JSONObject(decrypt(it,m)).getString("fingerprint")==r.getString("fingerprint"))}}catch(_:Exception){error("Could not save protected pairing data. Pairing remains blocked until a safe retry.")}
    }
    fun status():JSONObject = try {
        val (m,r)=load();val key=keys.getKey(m.getString("identityAlias"),null) as PrivateKey
        val info=KeyFactory.getInstance(key.algorithm,"AndroidKeyStore").getKeySpec(key,KeyInfo::class.java)
        @Suppress("DEPRECATION") val hardware=if(Build.VERSION.SDK_INT>=31)info.securityLevel in setOf(KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT,KeyProperties.SECURITY_LEVEL_STRONGBOX) else info.isInsideSecureHardware
        JSONObject().put("status","ready").put("platform","android").put("fingerprint",r.getString("fingerprint")).put("createdAt",r.getLong("createdAt")).put("protection",if(hardware)"Android Keystore · hardware protected" else "Android Keystore · software protected").put("nonExportable",true)
    }catch(e:Exception){val state=if(!anchor.exists()&&!sealed.exists()&&!keys.containsAlias(firstIdentity)&&!keys.containsAlias(firstSeal))"uninitialized" else "blocked";val result=JSONObject().put("status",state).put("platform","android").put("error",e.message);try{val fp=JSONObject(String(bounded(anchor,1024),Charsets.UTF_8)).getString("fingerprint");if(fp.matches(Regex("[a-f0-9]{64}")))result.put("previousFingerprint",fp)}catch(_:Exception){};result}
    fun initialize(confirmed:Boolean,replace:Boolean=false,expectedFingerprint:String?=null):JSONObject {
        require(confirmed) { "Confirm creation or replacement of this device identity." };val state=status()
        if(!replace)require(state.getString("status")=="uninitialized") { "An identity already exists or needs explicit recovery." }
        else require(expectedFingerprint==(state.optString("fingerprint").ifEmpty { state.optString("previousFingerprint").ifEmpty { "unavailable" } })) { "Device identity changed since confirmation. Review it again." }
        val previous=try { marker() }catch(_:Exception){null}
        val generation=UUID.randomUUID().toString();val identityAlias=if(replace)"lightsout.handoff.identity.$generation" else firstIdentity;val sealAlias=if(replace)"lightsout.handoff.registry.$generation" else firstSeal;val now=clock.now()
        val generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore")
        generator.initialize(KeyGenParameterSpec.Builder(identityAlias,KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY).setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1")).setDigests(KeyProperties.DIGEST_SHA256).setUserAuthenticationRequired(false).setCertificateSubject(X500Principal("CN=Lights Out routine handoff")).setCertificateSerialNumber(BigInteger(128,SecureRandom()).add(BigInteger.ONE)).setCertificateNotBefore(Date(now-60000)).setCertificateNotAfter(Date(now+365L*86400000)).build());generator.generateKeyPair()
        val sealGenerator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");sealGenerator.init(KeyGenParameterSpec.Builder(sealAlias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());sealGenerator.generateKey()
        val fp=RoutineHandoff.fingerprint(keys.getCertificate(identityAlias).encoded);val m=JSONObject().put("version",1).put("installId",generation).put("fingerprint",fp).put("identityAlias",identityAlias).put("sealAlias",sealAlias)
        val r=JSONObject().put("version",1).put("installId",generation).put("fingerprint",fp).put("createdAt",now).put("lastWall",now).put("trust",HandoffTrust.empty(fp));write(m,r);atomic(anchor,m.toString().toByteArray()){require(JSONObject(String(it)).getString("fingerprint")==fp)}
        // Retire only aliases referenced by the previous valid marker. Keep the
        // first sealing alias as a loss-detection marker, never enumerate keys.
        previous?.let { old -> for(name in listOf("identityAlias","sealAlias")){val alias=old.getString(name);if(alias!=firstSeal&&alias!=identityAlias&&alias!=sealAlias)try{keys.deleteEntry(alias)}catch(_:Exception){}} }
        return status()
    }
    fun now():Long=load().second.getLong("lastWall").let { clock.now(it) }
    fun publicCertificate():X509Certificate=load().first.let { keys.getCertificate(it.getString("identityAlias")) as X509Certificate }
    fun readTrust(localId:String):JSONObject=load().second.let { require(it.getString("fingerprint")==localId) { "Device identity changed; re-enrollment is required." };it.getJSONObject("trust") }
    fun writeTrust(localId:String,value:JSONObject){val(m,r)=load();require(r.getString("fingerprint")==localId);r.put("trust",HandoffTrust.validate(value,localId));write(m,r)}
    fun keyManager():X509ExtendedKeyManager { val(m,_)=load();val own=m.getString("identityAlias");val key=keys.getKey(own,null) as PrivateKey;val chain=keys.getCertificateChain(own).map { it as X509Certificate }.toTypedArray()
        return object:X509ExtendedKeyManager(){
            private fun compatible(type:String?)=type?.startsWith("EC")==true
            override fun getPrivateKey(alias:String?)=if(alias==own)key else null
            override fun getCertificateChain(alias:String?)=if(alias==own)chain else null
            override fun getClientAliases(type:String?,issuers:Array<out java.security.Principal>?)=if(compatible(type))arrayOf(own) else null
            override fun getServerAliases(type:String?,issuers:Array<out java.security.Principal>?)=if(compatible(type))arrayOf(own) else null
            override fun chooseClientAlias(types:Array<out String>?,issuers:Array<out java.security.Principal>?,socket:java.net.Socket?)=if(types?.any(::compatible)==true)own else null
            override fun chooseServerAlias(type:String?,issuers:Array<out java.security.Principal>?,socket:java.net.Socket?)=if(compatible(type))own else null
            override fun chooseEngineClientAlias(types:Array<out String>?,issuers:Array<out java.security.Principal>?,engine:SSLEngine?)=if(types?.any(::compatible)==true)own else null
            override fun chooseEngineServerAlias(type:String?,issuers:Array<out java.security.Principal>?,engine:SSLEngine?)=if(compatible(type))own else null
        }
    }
}
