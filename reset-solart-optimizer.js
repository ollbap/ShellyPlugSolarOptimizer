/**
 * RESET FLAG
 * Clears the daily 'last run' flag and logs to allow a second execution.
 */
Shelly.call("KVS.Delete", { key: "solar_last_run_date" });

// Optional: Clear old logs to keep things tidy
Shelly.call("KVS.List", { match: "solar_log_*" }, function(res) {
  if (res && res.keys) {
    let keys = Object.keys(res.keys);
    for (let i = 0; i < keys.length; i++) {
      Shelly.call("KVS.Delete", { key: keys[i] });
    }
  }
});

print("System reset. You can now run SolarOptimizer again today.");
