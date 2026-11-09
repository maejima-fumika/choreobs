# Hardware Results

Results of running every step of `temperature-alert` on real devices, on 2026-11-08.

## Setup

| Endpoint | Device | Board | Device name |
|---|---|---|---|
| `display` | the Mac running `choreobs run` | `host` | — |
| `sensor` | M5Stack Fire (built-in MPU6886) | `esp32` | `SENSOR` |
| `backup` | M5Stack Fire (built-in MPU6886) | `esp32` | `BACKUP` |

- From step3 on, the thermometer drivers (`src/drivers/thermometer@sensor.bs` and `thermometer@backup.bs`) read the MPU6886's internal temperature sensor through the package [pkg-mpu6886-esp32](https://github.com/bluescript-lang/pkg-mpu6886-esp32). Each `esp32` endpoint lists it under `dependencies` in `choreobs.json`. Its dependency `i2c` is installed with it.
- The MPU6886 is on the M5Stack Fire's internal I2C bus: port `I2C0`, SDA 21, SCL 22.
- When `imu.init()` fails, `readTemperature()` returns `-100.0`.
- Each step was run from its directory:

  ```bash
  choreobs add-endpoint display -b host
  choreobs add-endpoint sensor -b esp32 -d SENSOR
  choreobs add-endpoint backup -b esp32 -d BACKUP   # step4 and step4.5 only
  choreobs install                                  # step3 on: installs mpu6886 and i2c
  choreobs run
  ```

## Results

Each displayed value is the measured temperature plus 1.5. The MPU6886 measures the temperature of the chip, so it reads about 40–46 °C, above room temperature. That is over the 31.0 threshold, so every step from step3 on shows `'Too Hot!'`.

| Step | Endpoints | Output on `display` | Result |
|---|---|---|---|
| step0-no-location | display | `16.900000` | ✅ |
| step1-add-display | display | `16.900000` | ✅ |
| step2-add-sensor-mock | display, sensor | `16.900000` | ✅ |
| step3-add-sensor | display, sensor | `41.980415`, `'Too Hot!'` | ✅ |
| step3.5-fully-static | display, sensor | `45.955326`, `'Too Hot!'` | ✅ |
| step4-add-backup | display, sensor, backup | `43.002449`, `'Too Hot!'` | ✅ on the 2nd run |
| step4.5-add-backup-no-implicit-dyn | display, sensor, backup | `44.235619`, `'Too Hot!'` | ✅ on the 2nd run |

In every successful run, every endpoint ended with `Finished` and `choreobs run` exited with 0. In step4 and step4.5 the sensor's reading was in the plausible range (−50 to 50), so the sensor's value was used and the backup was not read.

## Falling Back to the Backup

On real devices the sensor's reading is always plausible, so the backup path of step4 is not taken in a normal run. To check that path, we made the sensor's MPU6886 fail to initialize. We did this in a copy of step4, outside the repository:

1. In the copy's `src/drivers/thermometer@sensor.bs`, the I2C pins were changed from the ones the MPU6886 is wired to, to pins with nothing connected:

   ```ts
   const bus = new I2CMasterBus(I2CPort.I2C0, 25, 26);   // was 21, 22
   ```

   The backup's driver was left unchanged.
2. The sensor's `imu.init()` then fails, and `readTemperature()` returns `-100.0`.
3. `-100.0` is outside the range `plausible()` accepts, so `ok` is false and the choreography calls `readBackup()`.

Result: `35.444309` and `'Too Hot!'`, with all three endpoints `Finished`. The backup measured 33.94 °C. The sensor's own readings had all been 41–46 °C, so the value came from the backup.

## Known Issue: Disconnects After Repeated Runs

The first runs of step4, of step4.5 and of the fallback check failed. One M5Stack dropped its BLE connection (`[sensor ] Disconnected.` or `[backup ] Disconnected.`), and the other endpoints then stopped waiting for its messages, for example:

```text
[display] ** runtime error: sensor has finished without sending a message with tag "__top_0".
```

Running the same step again succeeded each time. This is not an error in the code ChoreoBS generates.

- Every failure came after the same M5Stack had run 3–4 programs in a row without a reset. Every run right after the device had crashed and restarted succeeded.
- Probable cause (not confirmed):
  - BlueScript's reset before a run clears its own memory, but does not restart the ESP32 (`main_thread_reset` in `microcontroller/core/src/main-thread.c`).
  - The driver never closes its I2C bus, so the ESP-IDF I2C bus of the previous run is still there.
  - In ESP-IDF v5.4.1, creating a master bus again on the same port fails with `ESP_ERR_INVALID_STATE`. Its error path also deinitializes the pins of the existing bus (`i2c_new_master_bus` in `esp_driver_i2c/i2c_master.c`).
- Workaround: press the reset button of each M5Stack before a run. Opening and closing the bus inside each `readTemperature()` call may avoid the problem, but this has not been tried.
