Pod::Spec.new do |s|
  s.name           = 'LumenCapture'
  s.version        = '0.1.0'
  s.summary        = 'Rear-camera fingertip capture for Lumen'
  s.description    = 'Streams per-frame finger-region color means from the rear camera with the torch on.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  # Swift 5 language mode, as in Expo's own module podspecs (for example ExpoKeepAwake in SDK 57).
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'CoreMotion', 'Accelerate', 'MapKit', 'Contacts'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
  # Package.swift and Tests/ only run the pure-code tests with `swift test` on a Mac; they are not app code.
  s.exclude_files = ['Package.swift', 'Tests/**/*', '.build/**/*']
end
