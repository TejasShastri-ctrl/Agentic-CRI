# API Documentation

## Rate Limits
Rate limits are enforced at the API gateway and vary by subscription tier:
- **Free**: 100 requests per minute
- **Standard**: 1,000 requests per minute
- **Pro**: 5,000 requests per minute
- **Enterprise**: 20,000 requests per minute (or custom as negotiated)

## v1 Deprecation Timeline
- **Announcement**: January 1, 2026
- **End of Support**: June 30, 2026
- **Total Shutdown**: December 31, 2026

## v2 Breaking Changes
- The `user_id` field has been changed from integer to UUID string.
- The `GET /analytics` endpoint now requires date ranges to be in ISO 8601 format rather than UNIX timestamps.

## Header Requirements
All v2 API requests must include the following headers:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`
- `X-API-Version: 2`
