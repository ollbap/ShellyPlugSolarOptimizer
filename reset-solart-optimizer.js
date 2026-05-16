/**
 * RESET FLAG
 * Clears the daily 'last run' flag.
 */
Shelly.call("KVS.Delete", { key: "solar_last_run_date" });

print("System reset. You can now run SolarOptimizer again today.");
