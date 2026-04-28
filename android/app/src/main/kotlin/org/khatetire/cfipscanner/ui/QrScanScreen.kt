package org.khatetire.cfipscanner.ui

import android.Manifest
import android.content.pm.PackageManager
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import org.khatetire.cfipscanner.R
import org.khatetire.cfipscanner.ui.theme.AntigravityColors
import java.util.concurrent.Executors

/**
 * Full-screen CameraX preview that decodes QR codes via ML Kit. The first
 * detected payload is delivered to [onResult] as a raw string; the caller is
 * responsible for parsing (vless://, ip:port, or plain IP).
 */
@Composable
fun QrScanScreen(onClose: () -> Unit, onResult: (String) -> Unit) {
    val ctx = LocalContext.current
    var hasPerm by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED
        )
    }
    val permLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted -> hasPerm = granted }

    LaunchedEffect(Unit) { if (!hasPerm) permLauncher.launch(Manifest.permission.CAMERA) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(AntigravityColors.Space),
    ) {
        if (hasPerm) {
            CameraPreview(onResult = onResult)
        } else {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(
                    Icons.Rounded.QrCodeScanner,
                    contentDescription = null,
                    tint = AntigravityColors.Aurora,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    text = stringResource(R.string.qr_permission_required),
                    color = AntigravityColors.OnDark,
                    fontSize = 14.sp,
                )
                Spacer(Modifier.height(12.dp))
                TextButton(onClick = { permLauncher.launch(Manifest.permission.CAMERA) }) {
                    Text(stringResource(R.string.qr_grant), color = AntigravityColors.Aurora)
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(AntigravityColors.Nebula.copy(alpha = 0.85f))
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = onClose) {
                Icon(Icons.Rounded.Close, contentDescription = null, tint = AntigravityColors.OnDark)
            }
            Spacer(Modifier.width(4.dp))
            Text(
                text = stringResource(R.string.qr_title),
                color = AntigravityColors.OnDark,
                fontSize = 16.sp,
                modifier = Modifier.weight(1f),
            )
        }
    }
}

@Composable
private fun CameraPreview(onResult: (String) -> Unit) {
    val ctx = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var fired by remember { mutableStateOf(false) }

    AndroidView(
        modifier = Modifier.fillMaxSize(),
        factory = { c ->
            val previewView = PreviewView(c)
            val providerFuture = ProcessCameraProvider.getInstance(c)
            providerFuture.addListener({
                val provider = providerFuture.get()
                val preview = Preview.Builder().build().also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                val analyzer = ImageAnalysis.Builder()
                    .setTargetResolution(Size(1280, 720))
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
                val opts = BarcodeScannerOptions.Builder()
                    .setBarcodeFormats(Barcode.FORMAT_QR_CODE, Barcode.FORMAT_CODE_128)
                    .build()
                val scanner = BarcodeScanning.getClient(opts)
                val executor = Executors.newSingleThreadExecutor()
                analyzer.setAnalyzer(executor) { proxy ->
                    val media = proxy.image
                    if (media == null) { proxy.close(); return@setAnalyzer }
                    val img = InputImage.fromMediaImage(media, proxy.imageInfo.rotationDegrees)
                    scanner.process(img)
                        .addOnSuccessListener { codes ->
                            if (!fired) {
                                val raw = codes.firstOrNull()?.rawValue
                                if (!raw.isNullOrBlank()) {
                                    fired = true
                                    onResult(raw)
                                }
                            }
                        }
                        .addOnCompleteListener { proxy.close() }
                }
                runCatching {
                    provider.unbindAll()
                    provider.bindToLifecycle(
                        lifecycleOwner,
                        CameraSelector.DEFAULT_BACK_CAMERA,
                        preview,
                        analyzer,
                    )
                }
            }, ContextCompat.getMainExecutor(c))
            previewView
        },
    )
}

/**
 * Best-effort extraction of an IP/host from a QR payload. Recognises raw
 * IPv4, ip:port, vless:// URIs, and falls back to the raw string trimmed.
 */
fun extractHostFromQr(raw: String): String {
    val trimmed = raw.trim()
    val fromUri = runCatching {
        when {
            trimmed.startsWith("vless://", ignoreCase = true) ||
            trimmed.startsWith("vmess://", ignoreCase = true) ||
            trimmed.startsWith("trojan://", ignoreCase = true) -> {
                // schema://uuid@host:port?... — host is between '@' and the
                // next ':' or '?' character.
                val afterAt = trimmed.substringAfter('@', "")
                val host = afterAt.substringBefore(':').substringBefore('?').substringBefore('/')
                host
            }
            trimmed.contains(':') && !trimmed.contains('/') -> trimmed.substringBefore(':')
            else -> trimmed
        }
    }.getOrDefault(trimmed)
    return fromUri.trim()
}
