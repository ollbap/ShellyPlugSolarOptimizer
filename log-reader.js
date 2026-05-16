/**
 * TIME-STEP LOG READER (mJS Safe)
 * Bypasses KVS.List completely. Generates the expected HH:MM keys 
 * mathematically based on the current time and goes back N steps.
 */

print("--- SOLAR OPTIMIZER: RECENT LOGS (LAST 10 HOURS) ---");

// 1. Generate the expected keys (20 steps of 30 mins = 10 hours)
let expectedKeys = [];
let steps = 20;

let now = new Date();
let h = now.getHours();
// Snap to the nearest past 30-min block (0 or 30)
let m = now.getMinutes() >= 30 ? 30 : 0;

for (let i = 0; i < steps; i++) {
  let hStr = JSON.stringify(h);
  let mStr = JSON.stringify(m);
  
  if (hStr.length < 2) hStr = "0" + hStr;
  if (mStr.length < 2) mStr = "0" + mStr;
  
  let key = "solar_log_" + hStr + mStr;
  
  // Store them in reverse order so the array is chronological (oldest to newest)
  expectedKeys[steps - 1 - i] = key;
  
  // Step back 30 minutes
  m -= 30;
  if (m < 0) {
    m = 30;
    h -= 1;
    if (h < 0) h = 23;
  }
}

function readNext(keys, index) {
  if (index >= keys.length) {
    print("--- END OF LOGS ---");
    Shelly.call("Script.Stop", { id: Shelly.getCurrentScriptId() });
    return;
  }

  Shelly.call("KVS.Get", { key: keys[index] }, function(res) {
    // If the key exists, print it. If not, silently ignore and continue.
    if (res && res.value) {
      print(res.value);
    }
    
    // Call next iteration
    readNext(keys, index + 1);
  });
}

// 2. Start the recursive fetch
readNext(expectedKeys, 0);
