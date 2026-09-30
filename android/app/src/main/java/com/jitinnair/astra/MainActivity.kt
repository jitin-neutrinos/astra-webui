package com.jitinnair.astra

import android.app.DownloadManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import com.getcapacitor.BridgeActivity

public class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(NativeNtfy::class.java)
        registerPlugin(CookieEncryptPlugin::class.java)
        super.onCreate(savedInstanceState)
        installDownloadListener()
        installBackHandler()
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
        if (level == TRIM_MEMORY_UI_HIDDEN) {
            bridge?.webView?.let { wv ->
                wv.pauseTimers()
                wv.onPause()
            }
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
