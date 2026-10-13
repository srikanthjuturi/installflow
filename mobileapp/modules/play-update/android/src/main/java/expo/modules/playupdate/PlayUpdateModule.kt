package expo.modules.playupdate

import android.app.Activity
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.InstallStateUpdatedListener
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Google Play's own "Update available" sheet — the FLEXIBLE in-app update.
 *
 * Three verbs and no policy. A flexible update downloads in the background and
 * then waits for `completeUpdate`, which RESTARTS the app; when that may happen
 * is decided in JS (`src/hooks/useStoreUpdate.ts`), because only JS knows
 * whether a proof is half-captured.
 *
 * The published wrapper, expo-in-app-updates, decides it for you: it restarts
 * the moment the download lands, and opens the Play Store over the app when a
 * background download fails. Either one, on a technician's phone at the
 * customer's door, loses the proof they were taking — which is why this exists.
 */
class PlayUpdateModule : Module() {
  private var manager: AppUpdateManager? = null

  // Fires while the app is in the background too — the one moment an install
  // may happen without anybody watching it restart.
  private val listener = InstallStateUpdatedListener { state ->
    if (state.installStatus() == InstallStatus.DOWNLOADED) sendEvent(DOWNLOADED)
  }

  override fun definition() = ModuleDefinition {
    Name("PlayUpdate")

    Events(DOWNLOADED)

    OnCreate {
      manager = appContext.reactContext?.let { context ->
        AppUpdateManagerFactory.create(context).also { it.registerListener(listener) }
      }
    }

    OnDestroy {
      manager?.unregisterListener(listener)
    }

    AsyncFunction("check") { promise: Promise ->
      val manager = manager
      if (manager == null) {
        promise.reject(unavailable())
      } else {
        manager.appUpdateInfo
          .addOnSuccessListener { info ->
            val status = info.installStatus()
            promise.resolve(
              mapOf(
                "available" to (
                  info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE &&
                    info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE) &&
                    status !in UNDER_WAY
                  ),
                "downloaded" to (status == InstallStatus.DOWNLOADED),
                "versionCode" to info.availableVersionCode(),
              )
            )
          }
          .addOnFailureListener { promise.reject(failed(it)) }
      }
    }

    // Resolves true when the technician tapped Update, false when they closed
    // the sheet — or when there was nothing to offer by the time it was asked.
    AsyncFunction("start") { promise: Promise ->
      val manager = manager
      val activity = appContext.currentActivity
      if (manager == null || activity == null) {
        promise.reject(unavailable())
      } else {
        manager.appUpdateInfo
          .addOnSuccessListener { info ->
            if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE ||
              !info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)
            ) {
              promise.resolve(false)
            } else {
              manager
                .startUpdateFlow(info, activity, AppUpdateOptions.defaultOptions(AppUpdateType.FLEXIBLE))
                .addOnSuccessListener { result -> promise.resolve(result == Activity.RESULT_OK) }
                .addOnFailureListener { promise.reject(failed(it)) }
            }
          }
          .addOnFailureListener { promise.reject(failed(it)) }
      }
    }

    // Restarts into the downloaded build. Silent when the app is in the
    // background; over the top of it otherwise.
    AsyncFunction("install") { promise: Promise ->
      manager?.completeUpdate()
      promise.resolve()
    }
  }

  private fun unavailable() =
    CodedException("ERR_PLAY_UPDATE_UNAVAILABLE", "No activity or Play update manager", null)

  private fun failed(cause: Exception) = CodedException("ERR_PLAY_UPDATE", cause.message, cause)

  private companion object {
    const val DOWNLOADED = "onDownloaded"

    // Already accepted: offering it again would start nothing new.
    val UNDER_WAY = setOf(
      InstallStatus.PENDING,
      InstallStatus.DOWNLOADING,
      InstallStatus.DOWNLOADED,
      InstallStatus.INSTALLING,
    )
  }
}
