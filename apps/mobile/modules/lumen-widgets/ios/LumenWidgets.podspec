Pod::Spec.new do |s|
  s.name           = 'LumenWidgets'
  s.version        = '0.1.0'
  s.summary        = 'Widget snapshot and standing-test live timer for Lumen'
  s.description    = 'Writes the widget snapshot to the App Group, reloads the widgets, and runs the standing-test Live Activity.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  # Swift 5 language mode, as in lumen-capture and Expo's own module podspecs.
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'ActivityKit', 'WidgetKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.swift"
end
