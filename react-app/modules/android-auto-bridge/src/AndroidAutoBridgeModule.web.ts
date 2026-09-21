import { registerWebModule, NativeModule } from 'expo';

// AndroidAutoBridge is Android-only; provide a no-op module on the web.
class AndroidAutoBridgeModule extends NativeModule<{}> {}

export default registerWebModule(AndroidAutoBridgeModule, 'AndroidAutoBridge');
