import Contacts
import ExpoModulesCore
import MapKit

// ADR 0054 §4: doctors' offices near the user for the Care map, from Apple Maps search. Apple publishes no rate limit,
// so each call runs exactly one search and a throttled one rejects with its own code (the screen says "try again
// shortly"). The same string is CARE_SEARCH_THROTTLED_CODE in src/LumenCaptureModule.ts.
private let careSearchThrottledCode = "ERR_CARE_SEARCH_THROTTLED"
private let careSearchErrorCode = "ERR_CARE_SEARCH"

// Main actor because MapKit search is UI-framework work and Apple calls its completion on the main thread.
@MainActor
func searchNearbyCare(lat: Double, lon: Double, radiusM: Double, query: String) async throws -> [[String: Any]] {
  let center = CLLocationCoordinate2D(latitude: lat, longitude: lon)
  guard CLLocationCoordinate2DIsValid(center), radiusM > 0, !query.trimmingCharacters(in: .whitespaces).isEmpty else {
    throw Exception(
      name: "CareSearchInput", description: "searchNearbyCare needs a valid point, a positive radius and a query",
      code: careSearchErrorCode)
  }
  let request = MKLocalSearch.Request()
  request.naturalLanguageQuery = query
  // The region only biases Apple's ranking, so results beyond the radius are dropped below.
  request.region = MKCoordinateRegion(center: center, latitudinalMeters: 2 * radiusM, longitudinalMeters: 2 * radiusM)
  request.resultTypes = .pointOfInterest

  let response: MKLocalSearch.Response
  do {
    response = try await MKLocalSearch(request: request).start()
  } catch let error as MKError where error.code == .loadingThrottled {
    throw Exception(
      name: "CareSearchThrottled", description: "Apple Maps search is busy; try again shortly",
      code: careSearchThrottledCode)
  } catch let error as MKError where error.code == .placemarkNotFound {
    // MapKit reports "nothing matched" as this error; for the map it is an empty list, not a failure.
    return []
  } catch {
    throw Exception(name: "CareSearchFailed", description: error.localizedDescription, code: careSearchErrorCode)
  }

  let origin = CLLocation(latitude: lat, longitude: lon)
  return response.mapItems.compactMap { item -> [String: Any]? in
    let placemark = item.placemark
    guard let name = item.name, let location = placemark.location, location.distance(from: origin) <= radiusM else {
      return nil
    }
    var place: [String: Any] = [
      "name": name,
      "lat": placemark.coordinate.latitude,
      "lon": placemark.coordinate.longitude,
      "address": postalLine(of: placemark),
    ]
    if let phone = item.phoneNumber, !phone.isEmpty {
      place["phone"] = phone
    }
    return place
  }
}

// One line, in the order the place's own country writes addresses. Empty when Apple has no postal address for it.
private func postalLine(of placemark: MKPlacemark) -> String {
  guard let postal = placemark.postalAddress else { return "" }
  return CNPostalAddressFormatter.string(from: postal, style: .mailingAddress)
    .split(separator: "\n")
    .joined(separator: ", ")
}
