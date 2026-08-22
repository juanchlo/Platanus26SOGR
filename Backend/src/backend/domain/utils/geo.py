"""Geodesic utility functions for geographical distance and centroid calculations."""

import math


def calculate_distance_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Calculate the great-circle distance between two coordinates in meters using the Haversine formula.

    :param lat1: Latitude of point 1 in decimal degrees.
    :param lng1: Longitude of point 1 in decimal degrees.
    :param lat2: Latitude of point 2 in decimal degrees.
    :param lng2: Longitude of point 2 in decimal degrees.
    :return: Distance in meters.
    """
    earth_radius_meters = 6_371_000.0

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * (math.sin(delta_lambda / 2.0) ** 2)
    )
    # Avoid domain error with precision issues
    a = min(1.0, max(0.0, a))
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

    return earth_radius_meters * c


def calculate_centroid(coords: list[tuple[float, float]]) -> tuple[float, float]:
    """Calculate the geographic centroid (average lat and lng) from a list of coordinates.

    :param coords: List of (lat, lng) tuples.
    :return: (centroid_lat, centroid_lng) rounded to 6 decimal places.
    """
    if not coords:
        raise ValueError("Cannot calculate centroid of an empty coordinates list.")

    avg_lat = sum(c[0] for c in coords) / len(coords)
    avg_lng = sum(c[1] for c in coords) / len(coords)
    return round(avg_lat, 6), round(avg_lng, 6)
