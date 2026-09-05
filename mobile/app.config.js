// Dynamic Expo config — layers secrets on top of app.json.
//
// Expo merges this over app.json automatically (app.json is passed in as
// `config`). Keep everything declarative in app.json; only put things here
// that must come from the environment.
//
// Set GOOGLE_MAPS_ANDROID_KEY as an EAS secret (or in mobile/.env for local
// builds) and REMOVE the literal key from app.json → android.config.googleMaps.
//   eas secret:create --scope project --name GOOGLE_MAPS_ANDROID_KEY --value <key>
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...(config.android?.config ?? {}),
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_ANDROID_KEY ?? config.android?.config?.googleMaps?.apiKey ?? '',
      },
    },
  },
});
