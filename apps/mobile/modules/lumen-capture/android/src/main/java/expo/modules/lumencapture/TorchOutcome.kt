package expo.modules.lumencapture

import androidx.camera.core.CameraControl

// CameraControl.OperationCanceledException docs: CameraX dropped the request because a newer value was set or the
// camera closed; it is not the torch refusing. On the Galaxy A17 (2026-10-04) TorchControl.reset() cancelled a
// restore this way when the app went to the background, and the next OPEN restored the torch. Any other failure
// (an ExecutionException cause, a CancellationException from cancel()) stays a failure.
internal fun isSupersededTorchRequest(failure: Throwable?): Boolean = failure is CameraControl.OperationCanceledException

internal fun torchOutcomeText(failure: Throwable?): String =
    when {
        failure == null -> "ok"
        isSupersededTorchRequest(failure) -> "superseded, ${failure.message}"
        else -> "failed, $failure"
    }
