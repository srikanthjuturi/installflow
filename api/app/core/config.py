"""Application settings, loaded from environment / .env via pydantic-settings."""

from functools import lru_cache
from urllib.parse import quote_plus

from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # ─── App ───────────────────────────────────────────────────────────────
    ENVIRONMENT: str = "development"
    DEBUG: bool = True
    SQL_ECHO: bool = False
    PROJECT_NAME: str = "Reliance GreenTech Installation API"
    API_V1_PREFIX: str = "/api/v1"

    # ─── CORS ──────────────────────────────────────────────────────────────
    # Origins allowed to call the API from a browser. Set CORS_ORIGINS in .env
    # as a JSON array to override the whole list.
    #
    # The deployed console lives in this default rather than in an App Service
    # setting on purpose: it is a fixed, public origin, and a browser blocks
    # EVERY request when it is missing — so the one place it must not be
    # forgotten is the place that ships with the code.
    #
    # `allow_credentials=True` in main.py means "*" is not available here: the
    # CORS spec rejects the wildcard once credentials are in play, so every
    # origin has to be named. Netlify deploy previews and branch deploys get
    # their own `<name>--reliancegreentech.netlify.app` hostnames and are NOT
    # covered — that needs `allow_origin_regex`, a wider grant than anyone has
    # asked for yet.
    #
    # Vite auto-increments its port when one is taken, so allow the usual range.
    CORS_ORIGINS: list[str] = [
        "https://reliancegreentech.netlify.app",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
    ]

    # ─── Database ──────────────────────────────────────────────────────────
    POSTGRES_HOST: str
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str
    POSTGRES_SSLMODE: str = "require"

    # ─── JWT ───────────────────────────────────────────────────────────────
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ─── Superadmin bootstrap (used by app.scripts.bootstrap) ──────────────
    SUPERADMIN_EMAIL: str = "superadmin@reliancegreentech.com"
    SUPERADMIN_PASSWORD: str = "ChangeMe_Superadmin@123"
    SUPERADMIN_NAME: str = "Super Admin"

    # Path to a CA bundle for outbound HTTPS. Only needed where something
    # intercepts TLS (corporate proxy, or antivirus web-shield on a dev box) and
    # its root is in the OS store but not in certifi's. Empty = normal
    # verification. Never disable verification instead.
    HTTP_CA_BUNDLE: str = ""

    # ─── WhatsApp Cloud API ────────────────────────────────────────────────
    # Unset in development: sends then fail softly and the code is logged
    # instead. Nothing in the flow blocks on Meta being configured.
    WHATSAPP_TOKEN: str = ""
    WHATSAPP_PHONE_NUMBER_ID: str = ""
    WHATSAPP_BUSINESS_ID: str = ""
    WHATSAPP_API_VERSION: str = "v21.0"
    # The invite template (UTILITY category).
    WHATSAPP_TEMPLATE_NAME: str = ""
    WHATSAPP_TEMPLATE_LANG: str = "en_US"
    # OTP needs its OWN template in the AUTHENTICATION category — Meta reviews
    # it separately from the invite one and will not deliver a one-time code
    # through a UTILITY template.
    WHATSAPP_OTP_TEMPLATE_NAME: str = ""
    WHATSAPP_OTP_TEMPLATE_LANG: str = "en_US"
    # The two customer-facing templates (UTILITY, like the invite): "pick a
    # slot" carries the link, "slot confirmed" is the receipt. Left empty they
    # fall back to free-form text, which only reaches someone who messaged this
    # number in the last 24 hours — fine against your own phone in dev, useless
    # for a real customer.
    WHATSAPP_SLOT_TEMPLATE_NAME: str = ""
    WHATSAPP_SLOT_CONFIRMED_TEMPLATE_NAME: str = ""
    WHATSAPP_SLOT_TEMPLATE_LANG: str = "en_US"
    # "Your installation is complete — please confirm and rate it." UTILITY,
    # like the other customer-facing ones. Its own lang setting rather than
    # sharing the slot one, because this template can be approved in a
    # different set of languages from the scheduling pair.
    WHATSAPP_FEEDBACK_TEMPLATE_NAME: str = ""
    WHATSAPP_FEEDBACK_TEMPLATE_LANG: str = "en_US"
    #: The only message this system sends to its own STAFF. Managers have no
    #: mobile app, so an escalation four hours from a slot cannot wait for
    #: somebody to open a browser tab.
    WHATSAPP_ESCALATION_TEMPLATE_NAME: str = ""
    WHATSAPP_ESCALATION_TEMPLATE_LANG: str = "en_US"
    # Comma-separated E.164 numbers. When set, ONLY these receive a real send;
    # anything else is refused before it reaches Meta.
    #
    # This exists because live credentials plus a test suite is a bad
    # combination: the verification scripts request codes for invented numbers
    # like +919110000001, and those belong to real people. Set this to your own
    # number while testing, and leave it empty in production.
    WHATSAPP_ALLOWLIST: str = ""

    # ─── Azure Blob Storage ────────────────────────────────────────────────
    # Where uploaded images live. Empty disables uploads with a clear message
    # rather than a 500 — the same shape as the WhatsApp integration.
    AZURE_STORAGE_CONNECTION_STRING: str = ""
    # Keeps its pre-rebrand name on purpose, like the App Service host — a
    # container cannot be renamed, every already-uploaded image is addressed by
    # a URL containing it, and nobody outside the team ever reads it. This is
    # infrastructure, not branding.
    AZURE_BLOB_CONTAINER: str = "installflow-media"
    # Proof photos live apart from everything else, in a container with NO
    # public access. They show the inside of a customer's home and the serial
    # off their appliance, so a permanent unauthenticated URL is the wrong
    # storage — reads are short-lived SAS links minted per request.
    AZURE_PROOF_CONTAINER: str = "installflow-proof"

    # ── Push notifications ────────────────────────────────────────────────
    #: Master switch. Off by default so a deployment without the Firebase
    #: credentials behind it does not spend twenty seconds per notification
    #: discovering that Expo cannot deliver.
    PUSH_ENABLED: bool = False
    #: Optional but recommended. With it set, Expo refuses any send that does
    #: not carry it — so a push token lifted off a device cannot be used to
    #: send arbitrary notifications to this app's users.
    EXPO_ACCESS_TOKEN: str = ""

    # ── Scheduled sweeps ──────────────────────────────────────────────────
    #: How often the time-based notifications are swept for. Both Azure workers
    #: wake together; a Postgres advisory lock decides which one actually runs.
    SWEEP_INTERVAL_SECONDS: int = 300
    #: A job still unassigned this close to its slot reaches the Area Service
    #: Manager. Matches the cancellation band: under four hours is the point at
    #: which a CANCELLED job escalates, so it is the point at which an empty
    #: one should too.
    ESCALATE_HOURS_BEFORE_SLOT: int = 4
    #: A customer who has not chosen a time in this long is one somebody has to
    #: telephone. The ticket cannot enter the pool until they do.
    SLOT_SILENCE_HOURS: int = 6
    #: A completed visit the customer never confirmed. Nothing is auto-closed —
    #: a manager force-closes it with supporting documents.
    FORCE_CLOSE_HOURS: int = 48
    #: How long before a slot the technician is reminded. The sweep runs every
    #: SWEEP_INTERVAL_SECONDS, so the reminder lands within one tick of this.
    SLOT_REMINDER_MINUTES: int = 60

    # ─── Technician onboarding ─────────────────────────────────────────────
    # Where an invite link points. The custom scheme is the DEVELOPMENT default:
    # it opens the app directly from `npx uri-scheme open` and needs no domain.
    #
    # It cannot ship: WhatsApp only auto-links http(s), so a `reliancegreentech://`
    # link arrives as dead text. Production needs an https universal/app link
    # (ios.associatedDomains + android.intentFilters) with a web fallback —
    # e.g. INVITE_LINK_BASE=https://install.reliancegreentech.in/invite
    INVITE_LINK_BASE: str = "reliancegreentech://invite"
    # ─── Customer slot confirmation ────────────────────────────────────────
    # Where the "pick a time" link points. Unlike the invite this is a WEB page
    # and always has been — a customer has no app to open — so the default is a
    # real http URL and works as soon as the API is reachable. Point it at the
    # public origin in production.
    SLOT_LINK_BASE: str = "http://localhost:8000/slot"
    # ─── Customer job confirmation ─────────────────────────────────────────
    # Where the "was your installation completed?" link points. Same shape and
    # same reasoning as SLOT_LINK_BASE: a customer has no app, so this is a web
    # page and the default is a real http URL.
    FEEDBACK_LINK_BASE: str = "http://localhost:8000/feedback"
    # Where the landing page sends someone who does not have the app yet.
    TECHNICIAN_APP_LINK: str = "https://install.reliancegreentech.in/technician"
    INVITE_EXPIRY_DAYS: int = 14

    # ─── Android App Links ─────────────────────────────────────────────────
    # Served at /.well-known/assetlinks.json so Android can verify that invite
    # links belong to the app and open it directly instead of a browser.
    #
    # The fingerprint is the SHA-256 of the APK's SIGNING certificate, not of
    # the APK. Read it from a built artifact with:
    #   apksigner verify --print-certs app.apk
    # It is not a secret — it is published deliberately — and it stays constant
    # for as long as the same keystore signs the app. A Play Store release
    # signed by Google App Signing has a DIFFERENT fingerprint, and both must be
    # listed here or links break for exactly one of the two install sources.
    #: Comma-separated, and more than one is the POINT.
    #:
    #: A package rename cannot be atomic: the API is redeployed in a second, and
    #: the phones running the old package are updated whenever their owners get
    #: round to it. Serving only the new name breaks App Links for everyone still
    #: on the old build — silently, because a failed verification looks exactly
    #: like a link that opens a browser.
    #:
    #: So list BOTH across a rename and drop the old one once nobody is on it.
    ANDROID_PACKAGE: str = "com.reliancegreentech.technician"
    ANDROID_CERT_FINGERPRINTS: str = ""

    #: The app's custom URL scheme, used by the invite landing page's button.
    #:
    #: Same migration problem as ANDROID_PACKAGE, without the same escape hatch:
    #: a link can only have ONE scheme, so this must name the scheme the app
    #: people ACTUALLY HAVE INSTALLED responds to — which during a rename is the
    #: old one. Move it only once the new build is on the devices that matter.
    APP_SCHEME: str = "reliancegreentech"

    # ─── OTP ───────────────────────────────────────────────────────────────
    # MUST match what the WhatsApp template tells the technician. The approved
    # `yar_otp` template says "Expires in 10 minutes" in its footer AND in its
    # copy-code button (code_expiration_minutes=10). At 300 the message
    # promised ten minutes and the code died at five, so someone who came back
    # after six was told their code was wrong — by an app that was wrong.
    # Change one of these and you must change the other; the template text is
    # the half that needs a Meta review, so the server is the half that moves.
    OTP_TTL_SECONDS: int = 600
    OTP_LENGTH: int = 6
    OTP_MAX_ATTEMPTS: int = 5
    OTP_RESEND_SECONDS: int = 30
    # The rolling window the two counters below are measured over. It used to be
    # a hard-coded hour, which meant one mistyped number could lock a technician
    # out of their own app for an hour in the field — far past the point of
    # deterring anyone. Five minutes still costs an attacker more than it is
    # worth (a 6-digit code needs ~10^6 guesses) while a real person waits out a
    # tea break. Named for what it is, so changing it does not leave a setting
    # called PER_HOUR measuring five minutes.
    OTP_WINDOW_MINUTES: int = 5
    OTP_MAX_PER_WINDOW: int = 5
    OTP_MAX_PER_IP_PER_WINDOW: int = 20
    # Server-side secret mixed into the stored hash. A 6-digit code has 10^6
    # entropy, so without this a database dump reverses every live code by
    # brute force in under a second. Startup refuses to run without it in
    # production.
    OTP_PEPPER: str = ""
    # Returns the code in the response body so the flow can be walked without
    # Meta credentials. Startup refuses to run with it on in production.
    OTP_DEV_ECHO: bool = True
    # How long the post-OTP registration token lives.
    REGISTRATION_TOKEN_MINUTES: int = 15

    @computed_field  # type: ignore[prop-decorator]
    @property
    def DATABASE_URL(self) -> str:
        """Async SQLAlchemy URL (psycopg 3 driver). Credentials are URL-encoded."""
        return (
            f"postgresql+psycopg://{quote_plus(self.POSTGRES_USER)}:"
            f"{quote_plus(self.POSTGRES_PASSWORD)}@"
            f"{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
            f"?sslmode={self.POSTGRES_SSLMODE}"
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]


settings = get_settings()
