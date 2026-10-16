// One protocol-client profile for registration, Passport and saved sessions.
// These describe a software client; they are not proof of a physical Android device.
const ANDROID_APP = Object.freeze({ aid: '1128', app_name: 'aweme', device_platform: 'android',
  version_code: '400700', version_name: '40.7.0', manifest_version_code: '400701',
  update_version_code: '40709900', channel: '49957579a' })
const ANDROID_PACKAGE = 'com.ss.android.ugc.aweme'
// Google lists SQ3A.220705.004 as Pixel 6 Android 12L (API 32).
const ANDROID_DEVICE = Object.freeze({ device_type: 'Pixel 6', device_brand: 'google',
  device_manufacturer: 'Google', os_api: '32', os_version: '12', language: 'zh', ac: 'wifi' })
const ANDROID_BUILD_ID = 'SQ3A.220705.004'
// Retain the configured network suffix pending independent verification of it.
// It does not imply that Node HTTPS implements Cronet or native device attestation.
const DEFAULT_ANDROID_USER_AGENT = `${ANDROID_PACKAGE}/${ANDROID_APP.manifest_version_code} (Linux; U; Android ${ANDROID_DEVICE.os_version}; zh_CN; ${ANDROID_DEVICE.device_type}; Build/${ANDROID_BUILD_ID}; Cronet/TTNetVersion:5f939e60 2024-03-01 QuicVersion:42b109e4 2024-03-01)`
const REGISTRATION_PROFILE_VERSION = 2
module.exports = { ANDROID_APP, ANDROID_PACKAGE, ANDROID_DEVICE, ANDROID_BUILD_ID,
  DEFAULT_ANDROID_USER_AGENT, REGISTRATION_PROFILE_VERSION }
