import EventKit

enum EventKitAuthorization {
    static func allowsRead(status: EKAuthorizationStatus) -> Bool {
        switch status {
        case .authorized, .fullAccess:
            return true
        case .writeOnly:
            return false
        case .notDetermined:
            // Permission requests are coordinated by CalendarService for .notDetermined/.writeOnly so headless invokes can still cancel cleanly.
            return false
        case .restricted, .denied:
            return false
        @unknown default:
            return false
        }
    }

    static func allowsWrite(status: EKAuthorizationStatus) -> Bool {
        switch status {
        case .authorized, .fullAccess, .writeOnly:
            return true
        case .notDetermined:
            // Permission requests are coordinated by CalendarService for .notDetermined/.writeOnly so headless invokes can still cancel cleanly.
            return false
        case .restricted, .denied:
            return false
        @unknown default:
            return false
        }
    }
}

