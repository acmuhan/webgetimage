// 必须在 import 'cap-widget' 之前执行：组件在模块加载时就会预取 WASM，
// 晚于它设置的地址不会生效。WASM 随前端一起打包，由本站提供，不依赖 jsDelivr。
import wasmUrl from '@cap.js/wasm/browser/cap_wasm_bg.wasm?url';
import hashwxUrl from '@cap.js/wasm/browser/hashwx.wasm?url';

window.CAP_CUSTOM_WASM_URL = new URL(wasmUrl, location.href).href;
window.CAP_CUSTOM_HASHWX_URL = new URL(hashwxUrl, location.href).href;
