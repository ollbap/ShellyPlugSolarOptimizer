/**
 * SOLAR OPTIMIZER (Single-Run Scheduled Version)
 * 
 * 1. Designed to execute every 30 mins via Shelly Cron (0 0,30 * * * *).
 * 2. Writes a rolling history log (solar_log_HHMM) and a quick status log (solar_last_result).
 * 3. Exits immediately after evaluation. Heating duration is managed by an Auto-Off timer.
 * 4. Includes API retry logic and a configurable force-run timeout.
 */

let CONFIG = {
  lat: "40.49",
  lon: "-3.87",
  timezone: "Europe/Madrid",
  cloudThreshold: 50,
  windowStart: 9.4,           // 10:30 AM
  windowEnd: 18.0,             // 06:00 PM
  forceRunAfterHours: 7.0,     // Hours past windowStart to force execution (e.g., 15:30)
  relayId: 0,
  maxApiRetries: 3,
  apiRetryDelay: 5000          // 5 seconds in ms
};

// Helper: Formats current local time and calculates the snapped KVS key
function getLogTime() {
  let now = new Date();
  let day = now.getDate();
  let h = JSON.stringify(now.getHours());
  let m = now.getMinutes();
  
  let readableH = h.length < 2 ? "0" + h : h;
  let readableM = m < 10 ? "0" + m : JSON.stringify(m);
  
  // Snap to closest 00 or 30 for the key to avoid polluting memory
  let snapM = m >= 15 && m < 45 ? "30" : "00";
  
  // Handle the edge case where rounding up pushes to the next hour
  let snapH = readableH;
  if (m >= 45) {
     let nextH = now.getHours() + 1;
     if (nextH === 24) nextH = 0;
     let strNextH = JSON.stringify(nextH);
     snapH = strNextH.length < 2 ? "0" + strNextH : strNextH;
  }
  
  let key = "solar_log_" + snapH + snapM;
  let text = day + "/" + readableH + ":" + readableM;
  
  return { key: key, text: text };
}

// Helper: Returns a unique key for today (e.g., "run_2026516")
function getTodayKey() {
  let now = new Date();
  return "run_" + now.getFullYear() + now.getMonth() + now.getDate();
}

// Overwrites history log, the "latest" result key, and cleanly exits
function writeLogsAndExit(message, shouldStopScript) {
  let timeData = getLogTime();
  let logEntry = timeData.text + " - " + message;
  let historyKey = timeData.key;
  
  print(logEntry);
  
  // 1. Write to the specific HHMM history slot
  Shelly.call("KVS.Set", { key: historyKey, value: logEntry }, function() {
    // 2. Overwrite the "latest" status key
    Shelly.call("KVS.Set", { key: "solar_last_result", value: logEntry }, function() {
      if (shouldStopScript) {
        Shelly.call("Script.Stop", { id: Shelly.getCurrentScriptId() });
      }
    });
  });
}

function startHeating(reason) {
  // Set lock for today so subsequent cron triggers abort immediately
  Shelly.call("KVS.Set", { key: "solar_last_run_date", value: getTodayKey() });
  Shelly.call("Switch.Set", { id: CONFIG.relayId, on: true });
  
  // Log and exit immediately. External hardware Auto-Off timer handles the shutoff.
  writeLogsAndExit("STARTING HEATER: " + reason, true);
}

function checkWeather(attempt) {
  let localHour = new Date().getHours();
  let url = "https://api.open-meteo.com/v1/forecast?" +
            "latitude=" + CONFIG.lat + "&longitude=" + CONFIG.lon + 
            "&hourly=cloud_cover&forecast_days=1&timezone=" + CONFIG.timezone;

  print("Fetching weather... (Attempt " + attempt + "/" + CONFIG.maxApiRetries + ")");
  
  Shelly.call("HTTP.GET", { url: url, timeout: 5 }, function(result, error_code, error_msg) {
    if (result && result.code === 200) {
      let data = JSON.parse(result.body);
      let cloudNow = data.hourly.cloud_cover[localHour];
      let cloudNext = data.hourly.cloud_cover[localHour + 1];
      let avgClouds = (cloudNow + cloudNext) / 2;
      
      if (avgClouds < CONFIG.cloudThreshold) {
        startHeating("Sun found (Avg " + JSON.stringify(avgClouds) + "% clouds)");
      } else {
        writeLogsAndExit("Skipping: Cloudy (Avg " + JSON.stringify(avgClouds) + "%).", true);
      }
    } else {
      // Retry Logic if API fails
      if (attempt < CONFIG.maxApiRetries) {
        print("API Error. Retrying in 5s...");
        Timer.set(CONFIG.apiRetryDelay, false, function() {
          checkWeather(attempt + 1);
        });
      } else {
        let errMsg = error_msg ? error_msg : (result ? "HTTP " + JSON.stringify(result.code) : "Unknown Error");
        writeLogsAndExit("Failed: Weather API unreachable after 3 retries. (" + errMsg + ")", true);
      }
    }
  });
}

// --- MAIN EXECUTION FLOW ---
function run() {
  let now = new Date();
  let currentTimeDecimal = now.getHours() + (now.getMinutes() / 60);

  // 1. Time Window Check
  if (currentTimeDecimal < CONFIG.windowStart || currentTimeDecimal >= CONFIG.windowEnd) {
    writeLogsAndExit("Ignored: Outside configured time window.", true);
    return;
  }

  // 2. Already Run Today Check
  Shelly.call("KVS.Get", { key: "solar_last_run_date" }, function(res) {
    if (res && res.value === getTodayKey()) {
      writeLogsAndExit("Ignored: Already successfully heated water today.", true);
      return;
    }

    // 3. Force On Logic (using dynamic config variable)
    if (currentTimeDecimal >= (CONFIG.windowStart + CONFIG.forceRunAfterHours)) {
      startHeating("Timeout restriction met (" + JSON.stringify(CONFIG.forceRunAfterHours) + " hours elapsed). Forcing run.");
    } else {
      // 4. Standard Weather Check
      checkWeather(1); // Start API call at attempt 1
    }
  });
}

run();
