use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::PathBuf, sync::{Mutex, OnceLock}};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Preferences {
    #[serde(default = "enabled_default")]
    pub enabled: bool,
    #[serde(default)]
    pub configured: bool,
}
fn enabled_default() -> bool { true }
impl Default for Preferences {
    fn default() -> Self { Self { enabled: true, configured: false } }
}
fn path() -> PathBuf {
    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_else(|| ".".into()))
        .join("piw-nailo").join("auto-depot.json")
}
pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64).unwrap_or(0)
}
type Store = BTreeMap<String, Preferences>;
fn store() -> &'static Mutex<Result<Store, String>> {
    static STORE: OnceLock<Mutex<Result<Store, String>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(match std::fs::read(path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Store::new()),
        Err(e) => Err(e.to_string()),
    }))
}
fn persist(values: &Store) -> Result<(), String> {
    let file = path();
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    let temporary = file.with_extension("json.tmp");
    std::fs::write(&temporary, serde_json::to_vec(values).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(temporary, file).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn auto_depot_get(account: String, legacy: Option<Preferences>) -> Result<Preferences, String> {
    if account.is_empty() { return Err("Personagem ausente".into()); }
    let mut guard = store().lock().map_err(|e| e.to_string())?;
    let values = guard.as_mut().map_err(|e| e.clone())?;
    if let Some(p) = values.get(&account) { return Ok(p.clone()); }
    let pref = legacy.unwrap_or_default();
    let mut next = values.clone(); next.insert(account, pref.clone());
    persist(&next)?; *values = next;
    Ok(pref)
}
#[tauri::command]
pub fn auto_depot_set(account: String, mut preferences: Preferences) -> Result<(), String> {
    if account.is_empty() { return Err("Personagem ausente".into()); }
    let mut guard = store().lock().map_err(|e| e.to_string())?;
    let values = guard.as_mut().map_err(|e| e.clone())?;
    preferences.configured |= values.get(&account).is_some_and(|p| p.configured);
    let mut next = values.clone(); next.insert(account, preferences);
    persist(&next)?; *values = next;
    Ok(())
}

#[derive(Debug, Clone, Default)]
pub struct AutoDepot {
    account: String,
    automation: Value,
    pokemons: BTreeMap<String, Value>,
    active_id: String,
    ready: bool,
    last_command: Option<i64>,
    last_sale: Option<i64>,
}
fn id(value: &Value) -> String {
    value.as_str().map(str::to_owned).or_else(|| value.as_u64().map(|v| v.to_string())).unwrap_or_default()
}
impl AutoDepot {
    pub fn observe(&mut self, raw: &Value) {
        let m = raw.get("data").unwrap_or(raw);
        let t = raw["t"].as_str().or_else(|| m["t"].as_str()).unwrap_or("");
        if matches!(t, "reset" | "disconnected" | "telemetry_gap") { *self = Self::default(); return; }
        if !matches!(t, "welcome" | "estado") { return; }
        let p = m.get("estado").unwrap_or(m);
        if t == "welcome" || p["cheio"] == true {
            *self = Self::default();
            self.account = id(&p["id"]);
        }
        if self.account.is_empty() { return; }
        if p.get("id").is_some() && id(&p["id"]) != self.account { *self = Self::default(); return; }
        if let Some(active) = p.get("activeId") { self.active_id = id(active); }
        if let Some(auto) = p.get("automation") {
            if let Some(fields) = auto.as_object() {
                if !self.automation.is_object() { self.automation = json!({}); }
                self.automation.as_object_mut().unwrap().extend(fields.clone());
                self.ready = true;
            } else { self.automation = Value::Null; self.ready = false; }
        }
        if let Some(list) = p["pokemons"].as_array() {
            self.pokemons = list.iter().map(|p| (id(&p["id"]), p.clone())).collect();
        }
        if let Some(list) = p["pkMud"].as_array() {
            for p in list { self.pokemons.insert(id(&p["id"]), p.clone()); }
        }
        if let Some(list) = p["pkFora"].as_array() {
            for p in list { self.pokemons.remove(&id(p)); }
        }
    }
    pub fn next_command(&mut self, now: i64) -> Result<Option<Value>, String> {
        if !self.ready || self.account.is_empty() { return Ok(None); }
        let mut pref = auto_depot_get(self.account.clone(), None)?;
        let before = pref.clone();
        let command = self.command(now, &mut pref);
        if pref != before { auto_depot_set(self.account.clone(), pref)?; }
        Ok(command)
    }
    fn command(&mut self, now: i64, pref: &mut Preferences) -> Option<Value> {
        if !self.ready || !pref.enabled { return None; }
        let a = &self.automation;
        let shiny = a["autoLockShiny"] == true;
        let nota = a["autoLockNota9"] == true;
        let p5 = a["autoLockP5"] == true;
        if !pref.configured {
            if self.last_command.is_some_and(|t| now - t < 5000) { return None; }
            let command = if !shiny { json!({"t":"shop.autoLockShiny","ativo":true}) }
                else if !nota || a["autoLockNotaMin"].as_f64() != Some(3.5) {
                    json!({"t":"shop.autoLockNota9","ativo":true,"nota":3.5})
                } else if !p5 { json!({"t":"shop.autoLockP5","ativo":true}) }
                else { pref.configured = true; self.last_command = Some(now); return None; };
            self.last_command = Some(now); return Some(command);
        }
        if !shiny || !nota || !p5 || self.last_command.is_some_and(|t| now - t < 5000)
            || self.last_sale.is_some_and(|t| now - t < 60000) { return None; }
        let locked = a["pokemonTravado"].as_array();
        let max = self.pokemons.values().filter(|p| p["slot"].is_null()
            && id(&p["id"]) != self.active_id && p["shiny"] != true && p["potencia"].as_u64() != Some(5)
            && !locked.is_some_and(|ids| ids.iter().any(|v| id(v) == id(&p["id"]))))
            .filter_map(|p| p["id"].as_u64().or_else(|| p["id"].as_str()?.parse().ok())).max()?;
        if max == 0 || max > 9_007_199_254_740_991 { return None; }
        self.last_sale = Some(now);
        Some(json!({"t":"shop.sellAllPokemons","ateId":max}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn auto() -> Value { json!({"autoLockShiny":true,"autoLockNota9":true,"autoLockNotaMin":3.5,"autoLockP5":true,"pokemonTravado":[8]}) }
    #[test]
    fn confirmations_rate_limit_deltas_and_disconnect() {
        let mut d = AutoDepot::default(); let mut pref = Preferences::default();
        d.observe(&json!({"t":"welcome","estado":{"id":1,"automation":{},"activeId":1,"pokemons":[{"id":1},{"id":8},{"id":9}]}}));
        assert_eq!(d.command(0,&mut pref).unwrap()["t"],"shop.autoLockShiny");
        assert!(d.command(1000,&mut pref).is_none()); assert!(!pref.configured);
        d.observe(&json!({"t":"estado","estado":{"automation":{"autoLockShiny":true}}}));
        assert_eq!(d.command(5000,&mut pref).unwrap()["nota"],3.5);
        d.observe(&json!({"t":"estado","estado":{"automation":{"autoLockShiny":true,"autoLockNota9":true,"autoLockNotaMin":3.5}}}));
        assert_eq!(d.command(10000,&mut pref).unwrap()["t"],"shop.autoLockP5");
        d.observe(&json!({"t":"estado","estado":{"automation":auto()}}));
        assert!(d.command(15000,&mut pref).is_none()); assert!(pref.configured);
        assert_eq!(d.command(20000,&mut pref).unwrap()["ateId"],9);
        assert!(d.command(21000,&mut pref).is_none());
        d.observe(&json!({"t":"estado","estado":{"pkFora":[9],"pkMud":[{"id":10,"slot":null}]}}));
        assert_eq!(d.command(80000,&mut pref).unwrap()["ateId"],10);
        d.observe(&json!({"t":"disconnected"})); assert!(d.command(140000,&mut pref).is_none());
    }
    #[test]
    fn preferences_survive_reconnection_and_keep_later_edits() {
        let mut d = AutoDepot::default(); let mut pref = Preferences { configured:true, enabled:false };
        d.observe(&json!({"t":"welcome","estado":{"id":2,"automation":auto(),"pokemons":[{"id":10}]}}));
        assert!(d.command(0,&mut pref).is_none()); pref.enabled = true;
        assert!(d.command(0,&mut pref).is_some());
        let mut edited = auto(); edited["autoLockNotaMin"] = json!(4.0);
        d.observe(&json!({"t":"welcome","estado":{"id":2,"automation":edited,"pokemons":[{"id":10}]}}));
        assert_eq!(d.command(60000,&mut pref).unwrap()["t"],"shop.sellAllPokemons");
        edited["autoLockP5"] = json!(false);
        d.observe(&json!({"t":"estado","estado":{"automation":edited}}));
        assert!(d.command(120000,&mut pref).is_none());
    }
    #[test]
    fn empty_depot_team_collection_shiny_and_p5_are_excluded() {
        let mut d = AutoDepot::default();
        let mut pref = Preferences { configured:true, enabled:true };
        let mut protected = auto(); protected["pokemonTravado"] = json!([100]);
        d.observe(&json!({"t":"welcome","estado":{"id":1,"activeId":104,"automation":protected,"pokemons":[
            {"id":9,"slot":null},{"id":100},{"id":101,"shiny":true},{"id":102,"potencia":5},
            {"id":103,"slot":0},{"id":104}
        ]}}));
        assert_eq!(d.command(0,&mut pref).unwrap()["ateId"],9);
        d.observe(&json!({"t":"estado","estado":{"pkFora":[9]}}));
        assert!(d.command(60000,&mut pref).is_none());
    }
}
