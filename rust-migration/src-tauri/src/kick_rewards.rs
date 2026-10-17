use serde_json::{json, Value};

// Recognizes official PokeIdle rewards on Kick channels (EXP: 300, Catch: 500, Lure: 1000).
pub fn catalog(raw: &Value) -> Vec<Value> {
    raw["data"].as_array().into_iter().flatten().filter_map(|r| {
        let title = r["title"].as_str()?.to_lowercase();
        let description = r["description"].as_str().unwrap_or("").to_lowercase();
        if !description.contains("pokeidle") { return None; }
        let (key, cost) = if title.contains("xp") || title.contains("exp") { ("exp", 300) }
            else if title.contains("capture") || title.contains("catch") { ("catch", 500) }
            else if title.contains("lure") || title.contains("secret") || title.contains("isca") { ("lure", 1000) }
            else { return None; };
        let id = r["id"].as_str()?;
        if id.len() != 26 || !id.bytes().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()) { return None; }
        Some(json!({
            "key": key,
            "id": id,
            "cost": cost,
            "available": r["cost"].as_u64() == Some(cost)
                && r["is_enabled"] == true
                && r["is_paused"] == false
                && r["is_user_input_required"] == false
        }))
    }).collect()
}

pub fn eligible<'a>(balance: &'a Value, priority: &str, now: u64) -> Option<&'a Value> {
    let checked = balance["checkedAt"].as_u64()?;
    if balance["status"]!="verified" || balance["catalogStatus"]!="verified" || now.checked_sub(checked)? >=120_000 {return None;}
    let points=balance["points"].as_u64()?;
    balance["rewards"].as_array()?.iter().find(|r| r["available"]==true
        && (priority=="all" || r["key"]==priority) && r["cost"].as_u64().map(|c|points>=c).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_paused_wrong_price_and_unrelated_rewards() {
        let mut r=json!({"id":"01M3WZ35RA642BBYFZ89CDQ23N","title":"Bônus +15% XP PokeIdle","description":"1 hora no PokeIdle","cost":300,"is_enabled":true,"is_paused":false,"is_user_input_required":false});
        assert_eq!(catalog(&json!({"data":[r.clone()]}))[0]["available"],true);
        r["is_paused"]=json!(true);
        assert_eq!(catalog(&json!({"data":[r.clone()]}))[0]["available"],false);
        r["is_paused"]=json!(false);r["cost"]=json!(301);
        assert_eq!(catalog(&json!({"data":[r.clone()]}))[0]["available"],false);
        r["description"]=json!("sound effect");assert!(catalog(&json!({"data":[r]})).is_empty());

        let lure = json!({"id":"01M3WZ35RA642BBYFZ89CDQ23X","title":"Secret Lure","description":"1 hora no PokeIdle","cost":1000,"is_enabled":true,"is_paused":false,"is_user_input_required":false});
        let cat = catalog(&json!({"data":[lure]}));
        assert_eq!(cat.len(), 1);
        assert_eq!(cat[0]["key"], "lure");
        assert_eq!(cat[0]["cost"], 1000);
        assert_eq!(cat[0]["available"], true);
    }
    #[test]
    fn requires_fresh_balance_catalog_selected_kind_and_sufficient_points() {
        let mut b=json!({"status":"verified","catalogStatus":"verified","checkedAt":1000,"points":300,"rewards":[{"key":"exp","available":true,"cost":300}]});
        assert!(eligible(&b,"exp",1000).is_some());assert!(eligible(&b,"catch",1000).is_none());
        assert!(eligible(&b,"all",121000).is_none());b["points"]=json!(299);assert!(eligible(&b,"exp",1000).is_none());
        b["points"]=json!(9999);b["catalogStatus"]=json!("unavailable");assert!(eligible(&b,"exp",1000).is_none());
    }
}
