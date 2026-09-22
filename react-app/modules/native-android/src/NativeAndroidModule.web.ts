import { registerWebModule, NativeModule } from 'expo';

// NativeAndroid is Android-only; provide a no-op module on the web.
class NativeAndroidModule extends NativeModule<{}> {}

export default registerWebModule(NativeAndroidModule, 'NativeAndroid');
