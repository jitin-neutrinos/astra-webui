package com.jitinnair.astra

import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.util.Log
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.URLUtil
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity

public class MainActivity : BridgeActivity() {
    companion object {
        private const val TAG = "AstraWebView"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(NativeNtfy::class.java)
        registerPlugin(CookieEncryptPlugin::class.java)
        registerPlugin(AstraBarsPlugin::class.java)
        registerPlugin(AstraThemePlugin::class.java)
        super.onCreate(savedInstanceState)
        installDownloadListener()
        installBackHandler()
        installRenderProcessHandler()
    }

    // R2 (perf audit 2026-10-03): recover from renderer death instead of dying.
    //
    // WebView runs its page in a SEPARATE sandboxed renderer process. Android
    // kills that process under memory pressure — routine on a loaded phone, and
    // near-certain once a PDF/PPTX viewer has been resident. Google's own docs
    // (developer.android.com/develop/ui/views/layout/webapps/handle-termination)
    // are explicit: without onRenderProcessGone returning true, the renderer
    // exit takes OUR process down with it, and the user sees the app vanish
    // when they switch back to it. Returning true lets us rebuild the WebView
    // and keep them where they were.
    //
    // Contract when this fires (per the same doc):
    //   1. Never reuse the dead WebView — remove, destroy, drop every reference.
    //   2. Build a fresh instance.
    //   3. Return true.
    // Returning false (or not implementing this) lets WebView kill the app.
    private fun installRenderProcessHandler() {
        val wv = bridge?.webView ?: return
        // Chain to Capacitor's own client so plugin routing + navigation
        // interception keep working; we only add the termination callback.
        val delegate = wv.webViewClient
        wv.webViewClient = object : WebViewClient() {
            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                Log.e(
                    TAG,
                    if (detail.didCrash()) "WebView renderer CRASHED — rebuilding"
                    else "WebView renderer KILLED for memory — rebuilding",
                )
                // 1. Detach and destroy the dead instance. Any later call on it
                //    is a use-after-free; Capacitor's bridge still holds a
                //    reference, so null out the view it would call into.
                try { view.stopLoading() } catch (_: Throwable) { /* already gone */ }
                try {
                    (view.parent as? android.view.ViewGroup)?.removeView(view)
                } catch (_: Throwable) { /* no parent */ }
                try { view.destroy() } catch (_: Throwable) { /* already destroyed */ }

                // 2. Recreate. setContentView re-inflates from activity_main,
                //    and the Capacitor bridge reloads server.url on its own.
                //    Persisted WebView state (if any) is restored in
                //    onRestoreInstanceState via WebView.restoreState.
                runOnUiThread {
                    try {
                        setContentView(R.layout.activity_main)
                        // The fresh WebView also needs the renderer-death
                        // handler, or the next kill takes the app down again.
                        installRenderProcessHandler()
                    } catch (e: Throwable) {
                        Log.e(TAG, "rebuild after renderer death failed", e)
                    }
                }
                // 3. Handled — do not kill the app.
                return true
            }

            // Preserve Capacitor's behaviour for everything else.
            override fun shouldOverrideUrlLoading(view: WebView, request: android.webkit.WebResourceRequest): Boolean =
                delegate?.shouldOverrideUrlLoading(view, request) ?: false

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                delegate?.onPageStarted(view, url, favicon)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                delegate?.onPageFinished(view, url)
            }
        }
    }

    // Downloads: the WebView turns anchor navigations with content-disposition
    // into onDownloadStart → DownloadManager. HttpOnly astra_session cookie is
    // forwarded because DownloadManager has its own HTTP stack.
    private fun installDownloadListener() {
        val wv = bridge?.webView ?: return
        wv.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            if (url.startsWith("blob:") || url.startsWith("data:")) {
                toast("Can't download this item"); return@setDownloadListener
            }
            try {
                val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
                val req = DownloadManager.Request(Uri.parse(url))
                    .addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url) ?: "")
                    .addRequestHeader("User-Agent", userAgent)
                    .setMimeType(mimeType)
                    .setTitle(name)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                if (Build.VERSION.SDK_INT >= 29) req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                else req.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, name)
                (getSystemService(DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
                toast("Downloading $name")
            } catch (e: Exception) {
                toast("Download failed")
            }
        }
    }

    // Back asks the page first (media viewer/overlays register window.__astraBack);
    // absent or false → default Activity behaviour (unchanged exit/background).
    private fun installBackHandler() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = bridge?.webView ?: return fallthrough()
                wv.evaluateJavascript("(typeof window.__astraBack==='function'&&window.__astraBack())===true") { r ->
                    if (r != "true") fallthrough()
                }
            }
            private fun fallthrough() { isEnabled = false; onBackPressedDispatcher.onBackPressed(); isEnabled = true }
        })
    }

    private fun toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleDeepLink(intent)
    }

    override fun onResume() {
        super.onResume()
        signalServiceForeground(true)
        // R4: WebView timers/rendering were paused on UI-hidden — resume them
        // BEFORE the JS poke, or the poke fires into a frozen WebView and is
        // silently lost.
        bridge?.webView?.onResume()
        bridge?.webView?.resumeTimers()
        // Tell the WebView the app is foreground again — the shell forces a WS
        // reconnect cycle if Doze silently dropped the socket. Emitted now and
        // again ~10s later (first frame after resume can wake the network
        // stack itself; by +10s a genuinely dead wire is knowable).
        emitResumeCheck()
        bridge?.webView?.postDelayed({ emitResumeCheck() }, 10_000)
        handleDeepLink(intent)
    }

    override fun onPause() {
        super.onPause()
        signalServiceForeground(false)
    }

    // R4: the app UI is fully hidden (screen off / other app on top). Pausing
    // timers + rendering stops JS churn and surface upkeep while backgrounded.
    // SAFE only since v1.5: background chat connectivity is native
    // (NtfyPushService chat leg), so the frozen WebView holds nothing the
    // connection needs.
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        val wv = bridge?.webView
        if (level == TRIM_MEMORY_UI_HIDDEN) {
            wv?.let {
                it.pauseTimers()
                it.onPause()
            }
            return
        }
        // R2 (perf audit 2026-10-03): react to REAL memory pressure, not just
        // "UI hidden". WebView memory is native, not Java heap — it is not
        // capped by maxHeap, never throws OOM, and silently grows into swap
        // until the Low Memory Killer steps in (Android's "Manage WebView
        // memory" guide). So the only lever is to shed on the signal.
        if (level >= TRIM_MEMORY_RUNNING_LOW) {
            Log.w(TAG, "trim memory level=$level — clearing WebView caches")
            wv?.let {
                try { it.clearCache(false) } catch (_: Throwable) { /* gone */ }
                try {
                    // Only when backgrounded — flush while visible would drop
                    // the page the user is looking at.
                    if (!it.isShown) CookieManager.getInstance().flush()
                } catch (_: Throwable) { /* ignore */ }
            }
        }
        // TRIM_MEMORY_COMPLETE means the process is a kill candidate. Stop the
        // renderer's own churn so whatever survives starts from a quiet state.
        if (level >= TRIM_MEMORY_COMPLETE) {
            Log.w(TAG, "trim memory level=$level — backgrounding WebView")
            wv?.let {
                try { it.onPause() } catch (_: Throwable) { /* gone */ }
            }
        }
    }

    // R2: persist WebView state across process death so a renderer rebuild (or
    // an OS kill) restores the user's place instead of dropping them on the
    // landing page. Android pairs this with onRenderProcessGone recovery.
    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        try {
            bridge?.webView?.saveState(outState)
        } catch (e: Throwable) {
            Log.w(TAG, "WebView.saveState failed", e)
        }
    }

    private fun signalServiceForeground(fg: Boolean) {
        val svc = Intent(this, NtfyPushService::class.java).setAction(
            if (fg) NtfyPushService.ACTION_APP_FOREGROUND else NtfyPushService.ACTION_APP_BACKGROUND
        )
        try { startService(svc) } catch (_: Exception) { /* service down — nothing to signal */ }
    }

    private fun emitResumeCheck() {
        bridge?.webView?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('astra:resume-check'));", null
        )
    }

    private fun handleDeepLink(intent: Intent?) {
        if (intent != null && Intent.ACTION_VIEW == intent.action) {
            val uri = intent.data ?: return
            if ("astra" != uri.scheme) return
            val path = uri.getQueryParameter("path") ?: return
            
            if (path.startsWith("/c/")) {
                val storedKey = path.substring(3)
                if (storedKey.isNotEmpty()) {
                    val prefs = getSharedPreferences("CapacitorStorage", android.content.Context.MODE_PRIVATE)
                    prefs.edit().putString("astra_stored_key", storedKey).apply()

                    val svc = Intent(this, NtfyPushService::class.java).apply {
                        action = NtfyPushService.ACTION_CHAT_OPENED
                        putExtra("stored_key", storedKey)
                    }
                    try { startService(svc) } catch (_: Exception) {}
                }
            }

            val web = bridge?.webView ?: return
            // Only same-app SPA paths are honored; strip anything that looks
            // like a scheme/host injection before it reaches location.href.
            val safePath = if (path.startsWith("/") && !path.contains("://") && !path.startsWith("//")) path else "/"
            web.post {
                web.evaluateJavascript(
                    "window.location.href = 'https://astra.jitinnair.com" + safePath.replace("'", "\\\\'") + "';",
                    null
                )
            }
        }
    }
}
