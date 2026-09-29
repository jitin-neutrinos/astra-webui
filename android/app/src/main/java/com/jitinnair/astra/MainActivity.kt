package com.jitinnair.astra

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.getcapacitor.BridgeActivity

public class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(NativeNtfy::class.java)
        registerPlugin(CookieEncryptPlugin::class.java)
        super.onCreate(savedInstanceState)
    }

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
            val web = bridge?.webView ?: return
            // Only same-app SPA paths are honored; strip anything that looks
            // like a scheme/host injection before it reaches location.href.
            val safePath = if (path.startsWith("/") && !path.contains("://") && !path.startsWith("//")) path else "/"
            web.post {
                web.evaluateJavascript(
                    "window.location.href = 'https://astra.jitinnair.com" + safePath.replace("'", "\\'") + "';",
                    null
                )
            }
        }
    }
}
