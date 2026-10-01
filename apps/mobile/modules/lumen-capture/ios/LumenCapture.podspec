Pod::Spec.new do |s|
  s.name           = 'LumenCapture'
  s.version        = '0.1.0'
  s.summary        = 'Rear-camera fingertip capture for Lumen'
  s.description    = 'Streams per-frame finger-region color means from the rear camera with the torch on.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
