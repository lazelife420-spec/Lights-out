package com.lightsout.companion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID
import android.util.JsonReader
import android.util.JsonToken
import java.io.StringReader
import java.math.BigDecimal

/** Offline v1 intent adapter. One existing phone-home commit stores each change. */
object RoutineInterchange {
    private fun strictJson(text: String): JSONObject {
        val reader = JsonReader(StringReader(text.removePrefix("\uFEFF")))
        reader.isLenient = false
        fun value(depth: Int): Any {
            require(depth <= 16) { "Routine JSON nesting is too deep." }
            return when(reader.peek()) {
                JsonToken.BEGIN_OBJECT -> { reader.beginObject(); val j = JSONObject(); val keys = mutableSetOf<String>()
                    while(reader.hasNext()) { val key = reader.nextName();require(keys.add(key)) { "Duplicate JSON field." };j.put(key,value(depth+1)) };reader.endObject();j }
                JsonToken.BEGIN_ARRAY -> { reader.beginArray();val a = JSONArray();while(reader.hasNext())a.put(value(depth+1));reader.endArray();a }
                JsonToken.STRING -> reader.nextString()
                JsonToken.NUMBER -> BigDecimal(reader.nextString())
                JsonToken.BOOLEAN -> reader.nextBoolean()
                JsonToken.NULL -> { reader.nextNull();JSONObject.NULL }
                else -> throw IllegalArgumentException("The routine file is not valid JSON.")
            }
        }
        reader.use { val j = value(0);require(j is JSONObject && reader.peek() == JsonToken.END_DOCUMENT) { "The routine file must contain one JSON object." };return j }
    }
    private fun objects(a: JSONArray) = (0 until a.length()).map { a.getJSONObject(it) }
    private fun fields(j: JSONObject, keys: Set<String>) {
        require(j.keys().asSequence().toSet() == keys) { "Missing or unsupported field in the routine file." }
    }
    private fun string(j: JSONObject, key: String): String {
        val v = j.get(key); require(v is String) { "Expected text in the routine file." }; return v
    }
    private fun integer(j: JSONObject, key: String): Long {
        val v = j.get(key); require(v is Number && v.toDouble().isFinite() && v.toDouble() == v.toLong().toDouble()) { "Expected an integer in the routine file." }; return v.toLong()
    }
    private fun ints(j: JSONObject, key: String): Set<Int> {
        val a = j.getJSONArray(key); require(a.length() <= 31) { "Too many calendar selectors." }
        val values = (0 until a.length()).map { val v = a.get(it); require(v is Number && v.toDouble() == v.toInt().toDouble()) { "Invalid calendar selectors." }; v.toInt() }
        require(values.distinct().size == values.size) { "Duplicate calendar selectors." }; return values.toSet()
    }
    private fun schedule(j: JSONObject, id: String, routineId: String): PhoneCalendarRule {
        fields(j, setOf("kind", "time", "weekdays", "monthDays", "months", "date", "timezone", "dstPolicy"))
        require(string(j,"timezone") == "device-local" && string(j,"dstPolicy") == "shift-forward-first") { "Unsupported calendar clock policy." }
        val kind = string(j,"kind"); val time = string(j,"time")
        require(time.matches(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]"))) { "Use hours and minutes." }
        require(kind == "once" || j.isNull("date")) { "Only individual-date rules carry a date." }
        return PhoneCalendarRule(id, routineId, kind, LocalTime.parse(time), ints(j,"weekdays"), ints(j,"monthDays"), ints(j,"months"),
            if(kind == "once") { val date = string(j,"date"); require(date.matches(Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}"))); LocalDate.parse(date) } else null, enabled = false)
    }
    fun parse(text: String): JSONObject {
        require(text.toByteArray(Charsets.UTF_8).size <= PortableRoutineChecks.MAX_BYTES) { "Routine files must be UTF-8 JSON up to 256 KiB." }
        val d = strictJson(text)
        fields(d, setOf("format", "schemaVersion", "routines", "rules"))
        require(string(d,"format") == "lights-out.routines" && integer(d,"schemaVersion") == 1L) { "Unsupported routine file format or version." }
        val routines = objects(d.getJSONArray("routines")); val rules = objects(d.getJSONArray("rules"))
        require(routines.size in 1..32 && rules.size <= 64) { "Keep up to 32 routines and 64 rules per file." }
        val ids = mutableSetOf<String>(); val ruleIds = mutableSetOf<String>()
        for(r in routines) {
            fields(r, setOf("id", "name", "actions")); val id = string(r,"id")
            require(PortableRoutineChecks.id(id) && ids.add(id)) { "Duplicate or invalid routine identity." }
            require(PortableRoutineChecks.name(string(r,"name"))) { "Name routines with 1–60 printable characters." }
            val actions = objects(r.getJSONArray("actions")); val actionIds = mutableSetOf<String>(); val types = mutableSetOf<String>(); val slots = mutableSetOf<String>()
            require(actions.size in 1..3) { "Choose one timer and up to two WiZ actions." }
            for(a in actions) {
                fields(a, setOf("id", "type", "phase", "parameters"))
                val type = string(a,"type"); val actionId = string(a,"id"); val p = a.getJSONObject("parameters")
                require(actionIds.add(actionId) && types.add(type)) { "Duplicate action identity or type." }
                fields(p, when(type) { "timer.start" -> setOf("seconds", "endAction"); "wiz.warm" -> setOf("bindings", "brightness"); "wiz.off" -> setOf("bindings"); else -> throw IllegalArgumentException("This action has no supported interchange adapter.") })
                val bindings = if(type != "timer.start") p.getJSONArray("bindings").let { a -> (0 until a.length()).map { val v = a.get(it);require(v is String) { "Light binding identities must be text." };v } } else emptyList()
                PortableRoutineChecks.action(actionId, type, string(a,"phase"), if(type == "timer.start") integer(p,"seconds") else 0,
                    if(type == "timer.start") string(p,"endAction") else "", bindings, if(type == "wiz.warm") integer(p,"brightness").also { require(it in 10..100) }.toInt() else 0)
                slots.addAll(bindings)
            }
            require("timer.start" in types && slots.size <= 8) { "A routine needs one timer and up to eight light bindings." }
        }
        for(r in rules) {
            fields(r, setOf("id", "routineId", "name", "schedule")); val id = string(r,"id"); val routineId = string(r,"routineId")
            require(PortableRoutineChecks.id(id) && ruleIds.add(id) && routineId in ids && PortableRoutineChecks.name(string(r,"name"))) { "Invalid rule identity, name or routine reference." }
            schedule(r.getJSONObject("schedule"), id, routineId)
        }
        return d
    }
    private fun library(c: JSONObject) = c.optJSONObject("portable") ?: JSONObject().put("routines", JSONArray()).put("rules", JSONArray())
    private fun existing(c: JSONObject): Pair<Set<String>,Set<String>> {
        val p = library(c)
        return (objects(c.optJSONArray("routines") ?: JSONArray()).map { it.getString("id") } + objects(p.getJSONArray("routines")).map { it.getJSONObject("intent").getString("id") }).toSet() to
            (objects(c.optJSONArray("rules") ?: JSONArray()).map { it.getString("id") } + objects(p.getJSONArray("rules")).map { it.getString("id") }).toSet()
    }
    fun preview(c: Context, text: String): JSONObject {
        val d = parse(text); val old = existing(PhoneHomeStore.config(c)); val rows = objects(d.getJSONArray("routines")).map { original ->
            val r = JSONObject(original.toString()); val actions = objects(r.getJSONArray("actions")); val issues = mutableListOf<String>()
            if(actions.first { it.getString("type") == "timer.start" }.getJSONObject("parameters").getString("endAction") != "reminder") issues.add("Choose the phone reminder instead of the Windows power ending.")
            if(actions.any { it.getString("type").startsWith("wiz.") }) issues.add("Bind light slots to saved phone lights, or explicitly omit lighting.")
            r.put("issues", JSONArray(issues)).put("conflict", r.getString("id") in old.first)
        }
        return JSONObject().put("document",d).put("routines",JSONArray(rows)).put("conflicts",JSONObject()
            .put("routines",JSONArray(objects(d.getJSONArray("routines")).map { it.getString("id") }.filter { it in old.first }))
            .put("rules",JSONArray(objects(d.getJSONArray("rules")).map { it.getString("id") }.filter { it in old.second })))
            .put("note","Times use this device’s local timezone. Import saves inactive drafts; adoption saves calendar rules disabled.")
    }
    fun importFile(c: Context, text: String, policy: String): JSONObject {
        require(policy in setOf("reject", "copy")) { "Choose reject conflicts or import as copies." }
        val d = parse(text); val config = PhoneHomeStore.config(c); val p = library(config); val old = existing(config)
        val usedRoutines = old.first.toMutableSet(); val usedRules = old.second.toMutableSet(); val remap = mutableMapOf<String,String>()
        fun identity(id: String, used: MutableSet<String>): String {
            if(used.add(id)) return id
            require(policy == "copy") { "Identity conflict: existing records were not changed. Choose Import as copies." }
            var next: String; do { next = UUID.randomUUID().toString() } while(!used.add(next)); return next
        }
        val routines = objects(d.getJSONArray("routines")); val rules = objects(d.getJSONArray("rules"))
        require(p.getJSONArray("routines").length() + routines.size <= 32 && p.getJSONArray("rules").length() + rules.size <= 64) { "Keep up to 32 imported routines and 64 imported rules." }
        for(r in routines) { val id = r.getString("id"); val mapped = identity(id, usedRoutines); remap[id] = mapped; r.put("id",mapped) }
        for(r in rules) { r.put("id", identity(r.getString("id"),usedRules)); r.put("routineId",remap.getValue(r.getString("routineId"))) }
        routines.forEach { p.getJSONArray("routines").put(JSONObject().put("intent",it).put("adopted",false)) }
        rules.forEach { p.getJSONArray("rules").put(it) }; config.put("portable",p)
        // Draft import never calls the scheduler. One existing preferences
        // transaction preserves all other settings/timer/receipt keys.
        PhoneHomeStore.saveDraft(c,config); return JSONObject().put("count",routines.size)
    }
    fun list(c: Context): JSONObject {
        val config = PhoneHomeStore.config(c); val p = library(config)
        val native = objects(config.optJSONArray("routines") ?: JSONArray()); val entries = objects(p.getJSONArray("routines"))
        val choices = native.map { JSONObject().put("id",it.getString("id")).put("kind","phone").put("name",it.getString("name") + " · saved routine") } +
            entries.filter { e -> native.none { it.getString("id") == e.getJSONObject("intent").getString("id") } }.map { JSONObject().put("id",it.getJSONObject("intent").getString("id")).put("kind","portable").put("name",it.getJSONObject("intent").getString("name") + " · imported") }
        val drafts = entries.map { e -> JSONObject(e.toString()).put("rules",JSONArray(objects(p.getJSONArray("rules")).filter { it.getString("routineId") == e.getJSONObject("intent").getString("id") })) }
        return JSONObject().put("platform","android").put("choices",JSONArray(choices)).put("drafts",JSONArray(drafts)).put("lights",JSONArray(PhoneHomeStore.lights(c)))
    }
    fun adopt(c: Context, options: JSONObject): JSONObject {
        val config = PhoneHomeStore.config(c); val p = library(config); val id = options.getString("id")
        val entry = objects(p.getJSONArray("routines")).find { it.getJSONObject("intent").getString("id") == id && !it.optBoolean("adopted") }
            ?: throw IllegalArgumentException("Choose an inactive imported routine.")
        val seconds = integer(options,"seconds"); require(seconds in 60..86400 && string(options,"endAction") == "reminder") { "Review the duration and choose the phone reminder." }
        val oldRoutines = objects(config.optJSONArray("routines") ?: JSONArray()); val oldRules = objects(config.optJSONArray("rules") ?: JSONArray())
        val rules = objects(p.getJSONArray("rules")).filter { it.getString("routineId") == id }
        require(oldRoutines.none { it.getString("id") == id } && rules.none { r -> oldRules.any { it.getString("id") == r.getString("id") } }) { "An identity now conflicts; existing records were not changed." }
        require(oldRoutines.size < 32 && oldRules.size + rules.size <= 64) { "Keep up to 32 routines and 64 calendar rules." }
        val intent = entry.getJSONObject("intent"); val actions = objects(intent.getJSONArray("actions")); val timer = actions.first { it.getString("type") == "timer.start" }
        val omit = options.optBoolean("omitLights"); val bindings = options.optJSONObject("bindings") ?: JSONObject(); val saved = PhoneHomeStore.lights(c)
        fun targets(a: JSONObject?): List<String> = if(a == null || omit) emptyList() else PhoneHomeStore.strings(a.getJSONObject("parameters").getJSONArray("bindings")).map { slot ->
            val ip = bindings.optString(slot); require(ip in saved) { "Bind each light slot to a saved phone light, or explicitly omit lighting." }; ip
        }.distinct().sorted()
        val warm = actions.find { it.getString("type") == "wiz.warm" }; val off = actions.find { it.getString("type") == "wiz.off" }
        val warmTargets = targets(warm); val offTargets = targets(off)
        val requiredSlots = actions.flatMap { a -> PhoneHomeStore.strings(a.getJSONObject("parameters").optJSONArray("bindings")) }.distinct()
        val localBindings = if(omit) emptyMap() else requiredSlots.associateWith { bindings.getString(it) }
        require(localBindings.values.distinct().size == localBindings.size) { "Choose a different saved light for each abstract slot." }
        val actionIds = actions.associate { it.getString("type") to it.getString("id") }
        val routine = PhoneRoutine(id,intent.getString("name"),seconds,(warmTargets+offTargets).distinct().sorted(),
            if(warm != null && !omit) warm.getJSONObject("parameters").getInt("brightness") else 0, off != null && !omit,
            warmTargets = warmTargets, offTargets = offTargets, actionIds = actionIds, lightBindings = localBindings)
        val nativeRules = rules.map { r -> val rule = schedule(r.getJSONObject("schedule"), r.getString("id"),id).copy(createdAt = System.currentTimeMillis())
            val j = JSONObject().put("id",rule.id).put("routineId",id).put("name",r.getString("name")).put("kind",rule.kind).put("time",rule.time.toString())
                .put("weekdays",JSONArray(rule.weekdays.sorted())).put("monthDays",JSONArray(rule.monthDays.sorted())).put("months",JSONArray(rule.months.sorted()))
                .put("date",rule.date?.toString() ?: "").put("enabled",false).put("createdAt",rule.createdAt).put("plan",RoutinePlan.from(routine,rule).json(rule)); j }
        timer.getJSONObject("parameters").put("seconds",seconds).put("endAction","reminder")
        if(omit) intent.put("actions",JSONArray(listOf(timer)))
        entry.put("adopted",true);config.put("portable",p).put("routines",JSONArray(oldRoutines+routine.json())).put("rules",JSONArray(oldRules+nativeRules))
        PhoneHomeStore.saveDraft(c,config); return JSONObject().put("count",nativeRules.size)
    }
    fun export(c: Context, selection: JSONArray): JSONObject {
        val config = PhoneHomeStore.config(c); val p = library(config); val routines = PhoneHomeStore.routines(c)
        require(selection.length() in 1..32) { "Select up to 32 routines." }
        val ids = objects(selection).map { it.getString("id") }; require(ids.distinct().size == ids.size) { "Select each routine once." }
        val exported = mutableListOf<JSONObject>(); val rules = mutableListOf<JSONObject>()
        for(id in ids) {
            val native = routines.find { it.id == id }; val entry = objects(p.getJSONArray("routines")).find { it.getJSONObject("intent").getString("id") == id }
            require(native != null || entry != null) { "A selected routine is no longer available." }
            if(native == null) { exported.add(entry!!.getJSONObject("intent")); rules.addAll(objects(p.getJSONArray("rules")).filter { it.getString("routineId") == id }); continue }
            val plan = RoutinePlan.from(native); val addresses = plan.actions.flatMap { it.targets }.distinct().sorted()
            val slots = PortableRoutineChecks.slots(addresses,native.lightBindings)
            val actions = plan.actions.map { a -> JSONObject().put("id",a.id).put("type",a.type).put("phase",a.phase).put("parameters",
                if(a.type == "timer.start") JSONObject().put("seconds",a.seconds).put("endAction","reminder") else JSONObject().put("bindings",JSONArray(a.targets.map { slots.getValue(it) })).apply { if(a.type == "wiz.warm") put("brightness",a.brightness) }) }
            exported.add(JSONObject().put("id",native.id).put("name",native.name).put("actions",JSONArray(actions)))
            for(raw in objects(config.optJSONArray("rules") ?: JSONArray()).filter { it.getString("routineId") == id }) {
                val rule = PhoneHomeStore.rule(raw);val s = RoutinePlan.from(native,rule).json(rule).getJSONObject("schedule");s.remove("lateSeconds")
                rules.add(JSONObject().put("id",rule.id).put("routineId",id).put("name",raw.optString("name",native.name)).put("schedule",s))
            }
        }
        return parse(JSONObject().put("format","lights-out.routines").put("schemaVersion",1).put("routines",JSONArray(exported)).put("rules",JSONArray(rules)).toString())
    }
}
