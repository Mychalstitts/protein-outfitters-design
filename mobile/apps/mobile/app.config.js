// Dynamic Expo config — layers secrets on top of app.json.
// Expo merges this over app.json automatically (`config` is the static app.json).
// Set GOOGLE_MAPS_ANDROID_KEY in apps/mobile/.env (local) or as an EAS secret.
// Never commit a literal Maps key in app.json.
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY ?? '',
      },
    },
  },
});
