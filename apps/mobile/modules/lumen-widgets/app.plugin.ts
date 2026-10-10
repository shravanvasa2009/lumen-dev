import {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withInfoPlist,
  withStringsXml,
  type ConfigPlugin,
} from 'expo/config-plugins';

type AndroidManifest = AndroidConfig.Manifest.AndroidManifest;

// The Glance receivers and their appwidget-provider files (in the module's res/xml) for the small and
// medium home-screen widgets (spec §12.5, mockup 32) and the lock-screen widget (owner, 2026-10-05). The picker
// shows the app's own label, so a rename reaches it (spec §2). Exported because the widget host sends the update
// broadcasts. https://developer.android.com/develop/ui/compose/glance/create-app-widget
const RECEIVERS = [
  { name: 'expo.modules.lumenwidgets.SmallWidgetReceiver', provider: '@xml/lumen_widget_small' },
  { name: 'expo.modules.lumenwidgets.MediumWidgetReceiver', provider: '@xml/lumen_widget_medium' },
  { name: 'expo.modules.lumenwidgets.LockWidgetReceiver', provider: '@xml/lumen_widget_lock' },
];

function addWidgetReceivers(manifest: AndroidManifest): AndroidManifest {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const kept = (application.receiver ?? []).filter(
    (receiver) => !RECEIVERS.some(({ name }) => receiver.$['android:name'] === name),
  );
  application.receiver = [
    ...kept,
    ...RECEIVERS.map(({ name, provider }) => ({
      $: { 'android:name': name, 'android:exported': 'true' as const },
      'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
      'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': provider } }],
    })),
  ];
  return manifest;
}

const APP_GROUPS = 'com.apple.security.application-groups';

// The app and its widget extension share the snapshot through the App Group set in ios.entitlements
// (app.config.ts, ADR 0005). Its ID goes into the app's Info.plist so no Swift file hard-codes it; the
// extension reads the same key from the app bundle it sits in. NSSupportsLiveActivities lets the app start
// the standing-test Live Activity.
// https://developer.apple.com/documentation/bundleresources/information-property-list/nssupportsliveactivities
const withWidgetInfoPlist: ConfigPlugin = (config) =>
  withInfoPlist(config, (plistConfig) => {
    const appGroup = plistConfig.ios?.entitlements?.[APP_GROUPS]?.[0];
    if (typeof appGroup !== 'string') {
      throw new Error(`lumen-widgets: set ios.entitlements["${APP_GROUPS}"] in app.config.ts.`);
    }
    plistConfig.modResults.LumenAppGroup = appGroup;
    plistConfig.modResults.NSSupportsLiveActivities = true;
    return plistConfig;
  });

// The picker's medium preview names the app beside the mark. A library layout can't reach the app's label, so the
// module ships an empty lumen_widget_preview_name and the app's strings.xml overrides it with the app's name, which
// keeps a rename in one place (spec §2).
const withLumenWidgetsOnce: ConfigPlugin = (config) => {
  const withReceivers = withAndroidManifest(withWidgetInfoPlist(config), (manifestConfig) => {
    manifestConfig.modResults = addWidgetReceivers(manifestConfig.modResults);
    return manifestConfig;
  });
  return withStringsXml(withReceivers, (stringsConfig) => {
    const name = AndroidConfig.Resources.buildResourceItem({
      name: 'lumen_widget_preview_name',
      value: stringsConfig.name,
      translatable: false,
    });
    stringsConfig.modResults = AndroidConfig.Strings.setStringItem([name], stringsConfig.modResults);
    return stringsConfig;
  });
};

const withLumenWidgets = createRunOncePlugin(withLumenWidgetsOnce, 'lumen-widgets');

// Default export: Expo loads a plugin listed by path in app.config.ts from its default export.
export default withLumenWidgets;
