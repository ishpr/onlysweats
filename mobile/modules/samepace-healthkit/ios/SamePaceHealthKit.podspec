Pod::Spec.new do |s|
  s.name = 'SamePaceHealthKit'
  s.version = '1.0.0'
  s.summary = 'Read-only Apple Health import for SamePace'
  s.description = s.summary
  s.license = { :type => 'Proprietary' }
  s.author = 'SamePace'
  s.homepage = 'https://samepace.app'
  s.source = { :git => 'https://github.com/ishpr/onlysweats.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
