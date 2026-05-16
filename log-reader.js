/**
 * SIMPLIFIED SOLAR LOG READER (TIMER BASED)
 */

let MAX_LOGS = 20;
let keysToFetch = [];
let fetchIndex = 0;
let fetchTimer = null;

function padZero(val) {
  let str = JSON.stringify(val);
  return str.length < 2 ? "0" + str : str;
}

function buildKeyList() {
  let now = new Date();
  let h = now.getHours();
  let m = now.getMinutes() >= 30 ? 30 : 0;

  for (let i = 0; i < MAX_LOGS; i++) {
    let mStr = m === 0 ? "00" : "30";
    keysToFetch.push("solar_log_" + padZero(h) + mStr);
    
    // Math for the next iteration (going backwards)
    if (m === 30) {
      m = 0;
    } else {
      m = 30;
      h = h - 1;
      if (h < 0) h = 23; // Wrap around midnight
    }
  }
}

function exitScript() {
  // Stop the interval timer
  Timer.clear(fetchTimer);
  print("===================================");
  print("Finished reading logs. Exiting script.");
  Shelly.call("Script.Stop", { id: Shelly.getCurrentScriptId() });
}

function fetchNextKey() {
  // If we have read all keys, exit cleanly
  if (fetchIndex >= keysToFetch.length) {
    exitScript();
    return;
  }

  // Get the exact key for this tick
  let key = keysToFetch[fetchIndex];
  fetchIndex++;

  // Fetch from KVS
  Shelly.call("KVS.Get", { key: key }, function(res, err_code) {
    if (err_code === 0 && res && res.value) {
      print("[" + key + "] => " + res.value);
    } else {
      print("[" + key + "] => (No data)");
    }
  });
}

function start() {
  print("===================================");
  print("Initializing Log Reader...");
  
  let now = new Date();
  let todayKey = "run_" + JSON.stringify(now.getFullYear()) + JSON.stringify(now.getMonth()) + JSON.stringify(now.getDate());
  
  // 1. Check if the optimizer ran today
  Shelly.call("KVS.Get", { key: "solar_last_run_date" }, function(res, err_code) {
    if (err_code === 0 && res && res.value === todayKey) {
      print("HEATER STATUS: ON (Already run today)");
    } else {
      print("HEATER STATUS: OFF (Not run yet today)");
    }
    print("===================================");
    
    // 2. Synchronously build the array of 40 keys
    buildKeyList();
    
    // 3. Start reading them slowly (1 request every 400ms)
    // This entirely avoids recursion and prevents the Shelly from crashing.
    fetchTimer = Timer.set(400, true, fetchNextKey);
  });
}

// Start the process
start();
