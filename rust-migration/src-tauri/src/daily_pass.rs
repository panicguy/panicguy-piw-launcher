use serde_json::{json, Value};

#[derive(Debug, Clone, Default)]
pub struct DailyPass {
    player: Option<Value>,
    offset: i64,
    key: Option<(i64, bool)>,
    confirmed: Option<(i64, bool)>,
    attempts: u8,
    last: i64,
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64).unwrap_or(0)
}

impl DailyPass {
    pub fn observe(&mut self, raw: &Value, now: i64) {
        let m = raw.get("data").unwrap_or(raw);
        let t = raw["t"].as_str().or_else(|| m["t"].as_str()).unwrap_or("");
        if t == "welcome" { *self = Self::default(); }
        if matches!(t, "reset" | "disconnected" | "telemetry_gap") { *self = Self::default(); return; }
        if t == "welcome" || t == "estado" {
            let p = m.get("estado").unwrap_or(m);
            if t == "welcome" || p["cheio"] == true { self.player = Some(p.clone()); }
            else if let (Some(current), Some(delta)) = (self.player.as_mut().and_then(Value::as_object_mut), p.as_object()) {
                current.extend(delta.clone());
            }
            if let Some(server) = p["servidorAgora"].as_i64() { self.offset = now - server; }
        }
        if t == "passe" && m.get("resgate").is_some_and(Value::is_object) { self.confirmed = self.key; }
    }

    pub fn command(&mut self, now: i64) -> Option<Value> {
        let p = self.player.as_ref()?;
        if p["admin"] != true && p["level"].as_u64().unwrap_or(0) < 10 { return None; }
        let server_now = now - self.offset;
        let day = (server_now - 10_800_000).div_euclid(86_400_000);
        let pass = &p["passe"];
        let taken = pass["degrau"].as_u64().unwrap_or(0) >= 1 && pass["ultimo"].as_i64() == Some(day);
        let vip = pass["vipAte"].as_i64().unwrap_or(0) > server_now && pass["ultimoVip"].as_i64() != Some(day);
        if taken && !vip { return None; }
        let key = (day, taken);
        if self.key != Some(key) { self.key = Some(key); self.attempts = 0; self.last = 0; }
        if self.confirmed == Some(key) || self.attempts >= 3 || (self.last != 0 && now - self.last < 60_000) { return None; }
        self.attempts += 1; self.last = now;
        Some(json!({"t":"passe.resgatar"}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn eligibility_confirmation_vip_and_rollover() {
        let now = 20_000 * 86_400_000i64 + 10_800_000;
        let mut p = DailyPass::default();
        assert!(p.command(now).is_none());
        p.observe(&json!({"t":"welcome","estado":{"level":9}}), now);
        assert!(p.command(now).is_none());
        p.observe(&json!({"t":"estado","level":10}), now);
        assert_eq!(p.command(now), Some(json!({"t":"passe.resgatar"})));
        assert!(p.command(now + 5000).is_none());
        p.observe(&json!({"t":"passe","resgate":{"degrau":1}}), now);
        assert!(p.command(now + 60000).is_none());
        p.observe(&json!({"t":"estado","passe":{"ultimo":20000,"degrau":1}}), now);
        assert!(p.command(now).is_none());
        p.observe(&json!({"t":"estado","passe":{"ultimo":20000,"degrau":1,"vipAte":now+172800000}}), now);
        assert!(p.command(now).is_some());
        p.observe(&json!({"t":"passe","resgate":{}}), now);
        assert!(p.command(now + 60000).is_none());
        assert!(p.command(now + 86400000).is_some());
    }
    #[test]
    fn bounded_retries_and_server_clock() {
        let now = 20_000 * 86_400_000i64 + 10_800_000;
        let mut p = DailyPass::default();
        p.observe(&json!({"t":"welcome","estado":{"level":10,"servidorAgora":now-1,"passe":{"ultimo":19999,"degrau":3}}}), now);
        assert!(p.command(now).is_none());
        assert!(p.command(now + 1).is_some());
        assert!(p.command(now + 60001).is_some());
        assert!(p.command(now + 120001).is_some());
        assert!(p.command(now + 180001).is_none());
        p.observe(&json!({"t":"disconnected"}), now);
        assert!(p.command(now + 200000).is_none());
    }
}
