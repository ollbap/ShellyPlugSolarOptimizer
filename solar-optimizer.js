/**
 * SOLAR OPTIMIZER (Single-Run Scheduled Version)
 * 
 * 1. Designed to execute every 30 mins via Shelly Cron (0 0,30 * * * *).
 * 2. Writes a rolling history log (solar_log_HHMM) and a quick status log (solar_last_result).
 * 3. Safely stays active only if heating is required to track the 1.5h duration.
 */

let CONFIG = {
  lat: "40.49",
  lon: "-3.87",
  timezone: "Europe/Madrid",
  cloudThreshold: 50,
  onDuration: 90 * 60 * 1000,  // 1.5 hours in milliseconds
  windowStart: 9.4,           // 10:30 AM
  windowEnd: 18.0,             // 06:00 PM
  relayId: 0,
  maxApiRetries: 3,
  apiRetryDelay: 5000         // 5 seconds in milliseconds
};

function getLogTime() {
  let now = new Date();
  let hour = now.getHours();
  let minutes = now.getMinutes();
  
  let hStr = JSON.stringify(hour);
  hStr = hStr.length < 2 ? "0" + hStr : hStr;
  
  let mStr = JSON.stringify(minutes);
  mStr = mStr.length < 2 ? "0" + mStr : mStr;
  
  // Snap to the floor 30-minute block (e.g., 10:05 -> 1000, 10:35 -> 1030)
  let snappedMin = minutes < 30 ? "00" : "30";
  
  return {
    readable: hStr + ":" + mStr, // Exact time for the text log
    keySuffix: hStr + snappedMin // Rounded time for the KVS key
  };
}

function getTodayKey() {
  let now = new Date();
  return "run_" + JSON.stringify(now.getFullYear()) + JSON.stringify(now.getMonth()) + JSON.stringify(now.getDate());
}

// Logs to both the permanent history array and the instant-status key
function writeLogsAndExit(message, shouldStopScript) {
  let timeData = getLogTime();
  let logEntry = timeData.readable + " - " + message;
  let historyKey = "solar_log_" + timeData.keySuffix;
  
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

function finishHeating() {
  writeLogsAndExit("Heating cycle complete (1.5h). Powering off relay.", false);
  Shelly.call("Switch.Set", { id: CONFIG.relayId, on: false }, function() {
    // Safely exit now that the physical relay has been turned off
    Shelly.call("Script.Stop", { id: Shelly.getCurrentScriptId() });
  });
}

function startHeating(reason) {
  writeLogsAndExit("STARTING HEATER: " + reason, false);
  
  // Set lock for today so subsequent cron triggers abort immediately
  Shelly.call("KVS.Set", { key: "solar_last_run_date", value: getTodayKey() });
  Shelly.call("Switch.Set", { id: CONFIG.relayId, on: true });
  
  // Keep script alive strictly for the duration of the heating cycle
  Timer.set(CONFIG.onDuration, false, finishHeating);
}

function checkWeather(attempt) {
  if (attempt === undefined) attempt = 1;

  let localHour = new Date().getHours();
  let url = "https://api.open-meteo.com/v1/forecast?" +
            "latitude=" + CONFIG.lat + "&longitude=" + CONFIG.lon + 
            "&hourly=cloud_cover&forecast_days=1&timezone=" + CONFIG.timezone;

  if (attempt === 1) {
    writeLogsAndExit("Fetching weather forecast...", false);
  } else {
    print("API Retry " + JSON.stringify(attempt) + "/" + JSON.stringify(CONFIG.maxApiRetries) + "...");
  }
  
  // Added timeout to prevent hanging connections
  Shelly.call("HTTP.GET", { url: url, timeout: 5 }, function(result, err_code, err_msg) {
    if (err_code === 0 && result && result.code === 200) {
      let data = JSON.parse(result.body);
      let cloudNow = data.hourly.cloud_cover[localHour];
      let cloudNext = data.hourly.cloud_cover[localHour + 1];
      let avgClouds = (cloudNow + cloudNext) / 2;
      
      if (avgClouds < CONFIG.cloudThreshold) {
        startHeating("Sun found (Avg " + JSON.stringify(avgClouds) + "% clouds)");
      } else {
        writeLogsAndExit("Skipped: Cloudy (Avg " + JSON.stringify(avgClouds) + "%). Waiting for next check.", true);
      }
    } else {
      // Failure logic
      if (attempt < CONFIG.maxApiRetries) {
        Timer.set(CONFIG.apiRetryDelay, false, function() {
          checkWeather(attempt + 1);
        });
      } else {
        // Out of retries: build the specific error message
        let errorDetail = "Unknown Error";
        if (err_code !== 0) {
          errorDetail = "Network Code " + JSON.stringify(err_code) + " - " + err_msg;
        } else if (result) {
          errorDetail = "HTTP Status " + JSON.stringify(result.code);
        }
        writeLogsAndExit("Skipped: API failed after 3 tries (" + errorDetail + ").", true);
      }
    }
  });
}

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

    // 3. Force On Logic (5 hours past window start)
    if (currentTimeDecimal >= (CONFIG.windowStart + 5.0)) {
      startHeating("Timeout restriction met (5 hours elapsed). Forcing run.");
    } else {
      // 4. Standard Weather Check
      checkWeather();
    }
  });
}

run();
