# Kidport Backend API Documentation

Base URL: `/api/v1`

All JSON responses use the same envelope unless noted.

Success:

```json
{
  "success": true,
  "message": "Operation completed",
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": []
}
```

Paginated response:

```json
{
  "success": true,
  "message": "Results",
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "totalPages": 5
  }
}
```

Authentication header for protected routes:

```http
Authorization: Bearer <accessToken>
```

Common error statuses:

```json
{
  "400": "Validation failed or invalid request state",
  "401": "Authentication required or invalid token",
  "403": "Authenticated user lacks required permission",
  "404": "Resource not found",
  "409": "Conflict, such as duplicate email",
  "500": "Unexpected server error",
  "503": "External integration is not configured"
}
```

## Health

### GET `/health`

Auth: none

Response:

```json
{
  "success": true,
  "message": "API healthy",
  "data": {
    "version": "v1"
  }
}
```

## Auth

### POST `/auth/register`

Auth: none

Request body:

```json
{
  "fullName": "Jane Parent",
  "email": "jane@example.com",
  "password": "strongPassword123",
  "identity": "mother"
}
```

`identity`: `mother`, `father`, `parent`, `nanny`, `daycare`

Response:

```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "user": {
      "_id": "66f...",
      "fullName": "Jane Parent",
      "email": "jane@example.com",
      "profilePhoto": null,
      "userType": "caregiver",
      "caregiverRole": "mother",
      "status": "active"
    },
    "accessToken": "jwt...",
    "refreshToken": "opaque-refresh-token"
  }
}
```

Possible errors: `400`, `409`

### POST `/auth/login`

Auth: none

Request body:

```json
{
  "email": "jane@example.com",
  "password": "strongPassword123"
}
```

Response:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "_id": "66f...",
      "fullName": "Jane Parent",
      "email": "jane@example.com",
      "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg"
    },
    "accessToken": "jwt...",
    "refreshToken": "opaque-refresh-token"
  }
}
```

Possible errors: `400`, `401`

### POST `/auth/refresh-token`

Auth: none

Request body:

```json
{
  "refreshToken": "opaque-refresh-token"
}
```

Response:

```json
{
  "success": true,
  "message": "Token refreshed",
  "data": {
    "accessToken": "new-jwt...",
    "refreshToken": "new-opaque-refresh-token"
  }
}
```

Possible errors: `400`, `401`

### POST `/auth/logout`

Auth: none

Request body:

```json
{
  "refreshToken": "opaque-refresh-token"
}
```

Response:

```json
{
  "success": true,
  "message": "Logged out",
  "data": null
}
```

### POST `/auth/forgot-password`

Auth: none

Request body:

```json
{
  "email": "jane@example.com"
}
```

Response:

```json
{
  "success": true,
  "message": "If the email exists, a password reset OTP has been sent",
  "data": null
}
```

The backend sends a 4-digit OTP to the user's email. The OTP expires after 10 minutes.

### POST `/auth/verify-reset-otp`

Auth: none

Request body:

```json
{
  "email": "jane@example.com",
  "otp": "1234"
}
```

Response:

```json
{
  "success": true,
  "message": "OTP verified",
  "data": null
}
```

### POST `/auth/reset-password`

Auth: none

Request body:

```json
{
  "email": "jane@example.com",
  "otp": "1234",
  "password": "newStrongPassword123"
}
```

Response:

```json
{
  "success": true,
  "message": "Password reset successful",
  "data": null
}
```

Possible errors: `400`

### POST `/auth/change-password`

Auth: required

Request body:

```json
{
  "currentPassword": "oldPassword123",
  "newPassword": "newStrongPassword123"
}
```

Response:

```json
{
  "success": true,
  "message": "Password changed",
  "data": null
}
```

Possible errors: `400`, `401`

### GET `/auth/me`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Current user",
  "data": {
    "_id": "66f...",
    "fullName": "Jane Parent",
    "email": "jane@example.com",
    "userType": "caregiver",
    "caregiverRole": "mother",
    "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
    "status": "active"
  }
}
```

## Legal

### GET `/legal/terms`

Auth: none

Response:

```json
{
  "success": true,
  "message": "Legal document",
  "data": {
    "key": "terms",
    "version": "2026-08-10",
    "title": "Terms of Use",
    "content": "..."
  }
}
```

### GET `/legal/privacy-policy`

Auth: none

Response has the same shape as `/legal/terms`, with `key: "privacy-policy"`.

### GET `/legal/ai-disclaimer`

Auth: none

Response:

```json
{
  "success": true,
  "message": "Legal document",
  "data": {
    "key": "ai-disclaimer",
    "version": "2026-08-10",
    "title": "AI Disclaimer",
    "content": "AI-generated information is developmental guidance, not a medical diagnosis..."
  }
}
```

### POST `/legal/accept`

Auth: required

Request body:

```json
{
  "termsVersion": "2026-08-10",
  "privacyVersion": "2026-08-10",
  "aiDisclaimerVersion": "2026-08-10"
}
```

Response:

```json
{
  "success": true,
  "message": "Legal acceptance recorded",
  "data": {
    "_id": "66f...",
    "userId": "66f...",
    "termsVersion": "2026-08-10",
    "acceptedAt": "2026-08-10T00:00:00.000Z",
    "ip": "::1",
    "userAgent": "..."
  }
}
```

### POST `/legal/:key`

Auth: required

Creates a new active legal document version. `key` must be `terms`, `privacy-policy`, or `ai-disclaimer`. Existing active documents with the same key are archived.

Request body:

```json
{
  "content": "Full legal terms..."
}
```

Optional fields: `version`, `title`, `effectiveAt`. If omitted, `version` uses the effective date as `YYYY-MM-DD`, `title` uses the default title for the document type, and `effectiveAt` uses the current time.

Response:

```json
{
  "success": true,
  "message": "Legal document created",
  "data": {
    "_id": "66f...",
    "key": "terms",
    "version": "2026-08-11",
    "title": "Terms and Conditions",
    "content": "Full legal terms...",
    "status": "active"
  }
}
```

## Profile

### GET `/profile`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Profile",
  "data": {
    "_id": "66f...",
    "fullName": "Jane Parent",
    "email": "jane@example.com",
    "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
    "phoneNumber": "+15555555555",
    "bio": "..."
  }
}
```

### PATCH `/profile`

Auth: required

Request body:

```json
{
  "fullName": "Jane Smith",
  "phoneNumber": "+15555555555",
  "bio": "Parent and caregiver"
}
```

Response:

```json
{
  "success": true,
  "message": "Profile updated",
  "data": {
    "_id": "66f...",
    "fullName": "Jane Smith"
  }
}
```

### GET `/profile/stats`

Auth: required

Returns dashboard card counts for the logged-in caregiver across all children they can access.

Response:

```json
{
  "success": true,
  "message": "Caregiver stats",
  "data": {
    "totalObservations": 127,
    "totalMilestones": 15,
    "associatedChildren": 4
  }
}
```

### PATCH `/profile/photo`

Auth: required

Content type: `multipart/form-data`

Fields:

```text
photo: image/jpeg | image/png | image/webp
```

Response:

```json
{
  "success": true,
  "message": "Profile photo updated",
  "data": {
    "profileImage": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg"
  }
}
```

Possible errors: `400`, `503`

## Settings and Account

### GET `/settings`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Settings",
  "data": {
    "userId": "66f...",
    "language": "en",
    "notifications": {
      "milestoneAchievements": true,
      "careCircleUpdates": true,
      "aiInsights": true,
      "weeklyReports": true
    }
  }
}
```

### PATCH `/settings`

Auth: required

Request body:

```json
{
  "notifications": {
    "aiInsights": false
  }
}
```

Notification updates are partial. Sending one notification field updates only that field and keeps the previous values for the others.

Response:

```json
{
  "success": true,
  "message": "Settings updated",
  "data": {
    "userId": "66f...",
    "language": "en",
    "notifications": {}
  }
}
```

### DELETE `/settings/account`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Account deleted",
  "data": null
}
```

### DELETE `/account`

Auth: required

Same behavior as `/settings/account`.

## Children

Child access is allowed only for the child owner, accepted care circle members, or daycare staff whose daycare has an active assignment for the child.

### POST `/children`

Auth: required

Content type: `multipart/form-data`

Fields:

```text
photo: image/jpeg | image/png | image/webp
name: Leo Martinez
nickname: Leo
dob: 2024-09-02
gender: Male
bloodType: O+
height: 32
weight: 25
```

Required fields: `name`, `dob`, `gender`.

`height` is stored as inches and `weight` is stored as lbs when sent as simple numbers. JSON is also supported by sending `fullName` and `dateOfBirth` instead of `name` and `dob`.

JSON body:

```json
{
  "fullName": "Leo Martinez",
  "nickname": "Leo",
  "dateOfBirth": "2024-09-02",
  "gender": "male",
  "bloodType": "O+",
  "height": 32,
  "weight": 25
}
```

Response:

```json
{
  "success": true,
  "message": "Child created",
  "data": {
    "_id": "66f...",
    "fullName": "Leo Martinez",
    "nickname": "Leo",
    "profileImage": "https://kidport.s3.eu-north-1.amazonaws.com/children/66f.../profile/photo.jpg",
    "dateOfBirth": "2024-09-02T00:00:00.000Z",
    "gender": "male",
    "bloodType": "O+",
    "height": {
      "value": 32,
      "unit": "in"
    },
    "weight": {
      "value": 25,
      "unit": "lbs"
    },
    "createdBy": "66f...",
    "caregivers": ["66f..."],
    "status": "active",
    "age": {
      "years": 3,
      "months": 3,
      "totalMonths": 39
    },
    "developmentalAge": {
      "months": 38,
      "years": 3,
      "remainingMonths": 2,
      "days": 0,
      "label": "3 years 2 months 0 days"
    }
  }
}
```

### GET `/children`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Children",
  "data": [
    {
      "_id": "66f...",
      "fullName": "Ava Smith",
      "age": {
        "years": 3,
        "months": 3,
        "totalMonths": 39
      }
    }
  ]
}
```

### GET `/children/selector`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Child selector",
  "data": [
    {
      "id": "66f...",
      "profileImage": "https://kidport.s3.eu-north-1.amazonaws.com/children/66f.../profile/photo.jpg",
      "name": "Ava",
      "age": {
        "years": 3,
        "months": 3,
        "totalMonths": 39
      },
      "developmentalAge": {
        "months": 38,
        "years": 3,
        "remainingMonths": 2,
        "days": 0,
        "label": "3 years 2 months 0 days"
      },
      "active": true
    }
  ]
}
```

### GET `/children/:childId`

Auth: required, child access required

Response:

```json
{
  "success": true,
  "message": "Child",
  "data": {
    "_id": "66f...",
    "fullName": "Ava Smith",
    "age": {
      "years": 3,
      "months": 3,
      "totalMonths": 39
    }
  }
}
```

Possible errors: `403`, `404`

### PATCH `/children/:childId`

Auth: required, child owner required

Content type: `application/json` or `multipart/form-data`

JSON body:

```json
{
  "name": "Leo Martinez",
  "nickname": "Leo",
  "dob": "2024-09-02",
  "gender": "Male",
  "bloodType": "O+",
  "height": 32,
  "weight": 25
}
```

Multipart fields:

```text
photo: optional image/jpeg | image/png | image/webp
name: Leo Martinez
nickname: Leo
dob: 2024-09-02
gender: Male
bloodType: O+
height: 32
weight: 25
```

Response:

```json
{
  "success": true,
  "message": "Child updated",
  "data": {
    "_id": "66f...",
    "nickname": "Avie",
    "profileImage": "https://kidport.s3.eu-north-1.amazonaws.com/children/66f.../profile/photo.jpg"
  }
}
```

### DELETE `/children/:childId`

Auth: required, child owner required

Response:

```json
{
  "success": true,
  "message": "Child deleted",
  "data": null
}
```

### PATCH `/children/:childId/profile-photo`

Auth: required, child owner required

This route is still supported for existing clients. New clients can upload `photo` through `PATCH /children/:childId`.

Content type: `multipart/form-data`

Fields:

```text
photo: image/jpeg | image/png | image/webp
```

Response:

```json
{
  "success": true,
  "message": "Child profile photo updated",
  "data": {
    "profileImage": "https://kidport.s3.eu-north-1.amazonaws.com/children/66f.../profile/photo.jpg"
  }
}
```

## Dashboard

### GET `/children/:childId/dashboard`

Auth: required, child access required

Response:

```json
{
  "success": true,
  "message": "Dashboard",
  "data": {
    "child": {
      "_id": "66f...",
      "fullName": "Ava Smith"
    },
    "todayInsight": {
      "disclaimer": "AI insights are guidance only, not a diagnosis."
    },
    "developmentProgress": [
      {
        "domainId": "66f...",
        "name": "Language & Literacy",
        "percentage": 75,
        "stage": "steady",
        "keyword": "improving",
        "observationCount": 12
      }
    ],
    "observationSummary": {
      "childId": "66f...",
      "achieved": 3,
      "inProgress": 2,
      "upcoming": 2,
      "lastCalculatedAt": "2026-08-10T00:00:00.000Z"
    },
    "pediatricReport": {
      "overallScore": 72.5,
      "developmentalAge": {
        "months": 38,
        "years": 3,
        "remainingMonths": 2,
        "days": 0,
        "label": "3 years 2 months 0 days"
      }
    },
    "careCircle": [],
    "recentActivities": []
  }
}
```

## Care Circle

### GET `/children/:childId/care-circle`

Auth: required, child access required

Response:

```json
{
  "success": true,
  "message": "Care circle",
  "data": [
    {
      "_id": "66f...",
      "childId": "66f...",
      "userId": {
        "_id": "66f...",
        "fullName": "Jane Parent",
        "email": "jane@example.com",
        "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg"
      },
      "role": "mother",
      "relationship": "mother",
      "permissions": {
        "canView": true,
        "canComment": true,
        "canObserve": true,
        "canInvite": true,
        "canManage": true
      },
      "status": "active"
    }
  ]
}
```

### POST `/children/:childId/care-circle/invite`

Auth: required, child owner required

Request body:

```json
{
  "email": "nanny@example.com",
  "role": "nanny",
  "relationship": "weekday nanny",
  "message": "Please join Ava's care circle."
}
```

Response:

```json
{
  "success": true,
  "message": "Care circle invitation queued",
  "data": {
    "invitationId": "66f...",
    "emailStatus": "queued"
  }
}
```

Notes:

- Sending email does not grant access.
- Access is granted only after explicit invitation acceptance.
- Valid unregistered emails can receive invitations. After registering with that same email, the invitee can accept the invitation.
- Invalid email formats are rejected with `Invalid email`.
- A caregiver cannot invite their own email.
- Duplicate active care-circle members or pending invitations are rejected.
- Only the account matching the invited email can accept the invitation link.

### PATCH `/children/:childId/care-circle/:memberId`

Auth: required, child owner required

Request body:

```json
{
  "relationship": "grandmother",
  "permissions": {
    "canView": true,
    "canComment": true,
    "canObserve": false,
    "canInvite": false,
    "canManage": false
  }
}
```

Response:

```json
{
  "success": true,
  "message": "Care circle member updated",
  "data": {
    "_id": "66f...",
    "relationship": "grandmother"
  }
}
```

### DELETE `/children/:childId/care-circle/:memberId`

Auth: required, child owner required

Response:

```json
{
  "success": true,
  "message": "Care circle member removed",
  "data": null
}
```

### GET `/care-circle/invitations/:token/accept`

Auth: required

Request body: none

Response:

```json
{
  "success": true,
  "message": "Care circle invitation accepted",
  "data": {
    "_id": "66f...",
    "type": "care_circle",
    "status": "accepted",
    "acceptedAt": "2026-08-10T00:00:00.000Z"
  }
}
```

Possible errors: `400`, `403`

`POST /care-circle/invitations/:token/accept` is also supported for clients that prefer a non-GET state-changing request.

## Daycares

Parents/caregivers can list and view active daycares so they can send child assignment invitations. Only daycare accounts can create daycare records. Only the daycare owner can update or delete their daycare information.

### GET `/daycares`

Auth: required

Returns all active daycares.

Response:

```json
{
  "success": true,
  "message": "Daycares",
  "data": [
    {
      "_id": "66f...",
      "name": "Sunflower Daycare",
      "description": "Early childhood care center",
      "address": "123 Main St",
      "phoneNumber": "+15555555555",
      "email": "admin@sunflower.example",
      "status": "active"
    }
  ]
}
```

### POST `/daycares`

Auth: required, daycare account required

Request body:

```json
{
  "name": "Sunflower Daycare",
  "description": "Early childhood care center",
  "address": "123 Main St",
  "phoneNumber": "+15555555555",
  "email": "admin@sunflower.example"
}
```

Response:

```json
{
  "success": true,
  "message": "Daycare created",
  "data": {
    "_id": "66f...",
    "name": "Sunflower Daycare",
    "ownerId": "66f...",
    "status": "active"
  }
}
```

### GET `/daycares/:daycareId`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Daycare",
  "data": {
    "_id": "66f...",
    "name": "Sunflower Daycare"
  }
}
```

### PATCH `/daycares/:daycareId`

Auth: required, daycare owner required

Request body:

```json
{
  "name": "Sunflower Learning Center",
  "description": "Updated description",
  "address": "123 Main St",
  "phoneNumber": "+15555555555",
  "email": "admin@sunflower.example"
}
```

### DELETE `/daycares/:daycareId`

Auth: required, daycare owner required

Soft-deletes the daycare and removes its daycare member records.

Response:

```json
{
  "success": true,
  "message": "Daycare deleted",
  "data": null
}
```

Response:

```json
{
  "success": true,
  "message": "Daycare updated",
  "data": {
    "_id": "66f...",
    "name": "Sunflower Learning Center"
  }
}
```

### POST `/daycares/:daycareId/members`

Auth: required, daycare admin required

Request body:

```json
{
  "userId": "66f...",
  "role": "daycare_employee",
  "classroomIds": ["66f..."]
}
```

Response:

```json
{
  "success": true,
  "message": "Daycare member saved",
  "data": {
    "_id": "66f...",
    "daycareId": "66f...",
    "userId": "66f...",
    "role": "daycare_employee",
    "status": "active"
  }
}
```

### GET `/daycares/:daycareId/members`

Auth: required, daycare admin required

Response:

```json
{
  "success": true,
  "message": "Daycare members",
  "data": []
}
```

### PATCH `/daycares/:daycareId/members/:memberId`

Auth: required, daycare admin required

Request body:

```json
{
  "role": "daycare_admin",
  "classroomIds": ["66f..."]
}
```

Response:

```json
{
  "success": true,
  "message": "Daycare member updated",
  "data": {
    "_id": "66f...",
    "role": "daycare_admin"
  }
}
```

### DELETE `/daycares/:daycareId/members/:memberId`

Auth: required, daycare admin required

Response:

```json
{
  "success": true,
  "message": "Daycare member removed",
  "data": null
}
```

### POST `/children/:childId/daycare-invitations`

Auth: required, child owner required

Request body:

```json
{
  "daycareId": "66f...",
  "email": "admin@sunflower.example",
  "message": "Please review Ava's daycare assignment."
}
```

Response:

```json
{
  "success": true,
  "message": "Daycare invitation queued",
  "data": {
    "invitationId": "66f...",
    "emailStatus": "queued"
  }
}
```

Notes:

- The parent/caregiver controls assignment.
- The daycare does not gain active access until the invitation is accepted by an authorized daycare member.

### GET `/daycare-invitations/:token`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Daycare invitation",
  "data": {
    "token": "raw-token"
  }
}
```

### GET `/daycare-invitations/:token/accept`

Auth: required, daycare member required for invited daycare

Request body: none

Response:

```json
{
  "success": true,
  "message": "Daycare assignment accepted",
  "data": {
    "_id": "66f...",
    "childId": "66f...",
    "daycareId": "66f...",
    "status": "active",
    "acceptedAt": "2026-08-10T00:00:00.000Z"
  }
}
```

`POST /daycare-invitations/:token/accept` is also supported for clients that prefer a non-GET state-changing request.

### GET `/daycares/:daycareId/children/unassigned`

Auth: required, daycare member required

Response:

```json
{
  "success": true,
  "message": "Unassigned daycare children",
  "data": [
    {
      "_id": "66f...",
      "childId": {
        "_id": "66f...",
        "fullName": "Ava Smith"
      },
      "daycareId": "66f...",
      "status": "active"
    }
  ]
}
```

## Classrooms

### POST `/daycares/:daycareId/classrooms`

Auth: required, daycare admin required

Request body:

```json
{
  "name": "Sunflower Room",
  "icon": "sunflower",
  "theme": "yellow",
  "ageBand": "18-36 months",
  "leadTeacher": "66f...",
  "description": "Toddler classroom",
  "capacity": 12,
  "status": "active"
}
```

Response:

```json
{
  "success": true,
  "message": "Classroom created",
  "data": {
    "_id": "66f...",
    "daycareId": "66f...",
    "name": "Sunflower Room",
    "status": "active"
  }
}
```

### GET `/daycares/:daycareId/classrooms`

Auth: required, daycare member required

Response:

```json
{
  "success": true,
  "message": "Classrooms",
  "data": []
}
```

### GET `/classrooms/:classroomId`

Auth: required, daycare member required

Response:

```json
{
  "success": true,
  "message": "Classroom",
  "data": {
    "_id": "66f...",
    "name": "Sunflower Room",
    "daycareId": "66f..."
  }
}
```

### PATCH `/classrooms/:classroomId`

Auth: required, daycare admin required

Request body:

```json
{
  "name": "Rainbow Room",
  "capacity": 10,
  "description": "Updated classroom description"
}
```

Response:

```json
{
  "success": true,
  "message": "Classroom updated",
  "data": {
    "_id": "66f...",
    "name": "Rainbow Room"
  }
}
```

### DELETE `/classrooms/:classroomId`

Auth: required, daycare admin required

Response:

```json
{
  "success": true,
  "message": "Classroom archived",
  "data": null
}
```

### POST `/classrooms/:classroomId/children/:childId`

Auth: required, daycare member required

Request body: none

Response:

```json
{
  "success": true,
  "message": "Child assigned to classroom",
  "data": {
    "_id": "66f...",
    "childId": "66f...",
    "daycareId": "66f...",
    "classroomId": "66f...",
    "status": "active"
  }
}
```

Possible error:

```json
{
  "success": false,
  "message": "Child must be assigned to this daycare before classroom placement"
}
```

### DELETE `/classrooms/:classroomId/children/:childId`

Auth: required, daycare member required

Response:

```json
{
  "success": true,
  "message": "Child removed from classroom",
  "data": null
}
```

## Development Domains, Age Bands, and Indicators

### GET `/domains`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Development domains",
  "data": [
    {
      "_id": "66f...",
      "name": "Language & Literacy",
      "slug": "language-literacy",
      "sortOrder": 1,
      "status": "active"
    }
  ]
}
```

### POST `/domains`

Auth: required

Request body:

```json
{
  "name": "Language & Literacy"
}
```

The backend generates `slug` from `name`.

Response:

```json
{
  "success": true,
  "message": "Domain created",
  "data": {
    "_id": "66f...",
    "name": "Language & Literacy",
    "slug": "language-literacy"
  }
}
```

### PATCH `/domains/:domainId`

Auth: required

Request body:

```json
{
  "name": "Language and Literacy",
  "status": "active"
}
```

Response:

```json
{
  "success": true,
  "message": "Domain updated",
  "data": {
    "_id": "66f...",
    "name": "Language and Literacy"
  }
}
```

### GET `/age-bands`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Age bands",
  "data": [
    {
      "_id": "66f...",
      "label": "18-36 months",
      "minMonths": 18,
      "maxMonths": 36,
      "status": "active"
    }
  ]
}
```

### POST `/age-bands`

Auth: required

Request body:

```json
{
  "label": "18-36 months",
  "minMonths": 18,
  "maxMonths": 36,
  "status": "active"
}
```

Response:

```json
{
  "success": true,
  "message": "Age band created",
  "data": {
    "_id": "66f...",
    "label": "18-36 months"
  }
}
```

### GET `/indicators`

Auth: required

Query parameters:

```text
domainId=66f...
ageBandId=66f...
```

Response:

```json
{
  "success": true,
  "message": "Development indicators",
  "data": [
    {
      "_id": "66f...",
      "domainId": "66f...",
      "ageBandId": "66f...",
      "title": "Uses 3-word sentences",
      "status": "active"
    }
  ]
}
```

### POST `/indicators`

Auth: required

Request body:

```json
{
  "domainId": "66f...",
  "ageBandId": "66f...",
  "title": "Uses 3-word sentences",
  "description": "Combines three words in a meaningful phrase",
  "status": "active"
}
```

Response:

```json
{
  "success": true,
  "message": "Indicator created",
  "data": {
    "_id": "66f...",
    "title": "Uses 3-word sentences"
  }
}
```

### PATCH `/indicators/:indicatorId`

Auth: required

Request body:

```json
{
  "title": "Uses short sentences",
  "status": "active"
}
```

Response:

```json
{
  "success": true,
  "message": "Indicator updated",
  "data": {
    "_id": "66f...",
    "title": "Uses short sentences"
  }
}
```

## Observations

Stages accepted from the client:

```json
["emerging", "building", "steady", "confident"]
```

Backend score mapping:

```json
{
  "emerging": 1,
  "building": 2,
  "steady": 3,
  "confident": 4
}
```

The frontend must not send `stageScore`. The backend determines it. If `stage` is `confident`, `isMilestone` is set to `true`.

### POST `/children/:childId/observations`

Auth: required, child access required

Content type: `multipart/form-data` or JSON

Request fields:

```json
{
  "observation": "Ava named three colors during play.",
  "keyword": "steady",
  "domain": "Language & Literacy",
  "react": "love"
}
```

Required fields: `keyword`, `domain`, and either `observation` text or a media file.

`keyword` must be one of `emerging`, `building`, `steady`, or `confident`.

`domain` can be a domain id, exact domain name, or slug. `domainId` is also supported.

Multipart media field:

```text
media: one or more image, audio, or video files
```

`observation` can also be used as the file field name for media uploads.

When `type` is omitted, the backend infers it from `media`; if no media is uploaded, it uses `text`.

If a caregiver uploads an image, audio, or video, the backend saves the media to S3 before responding. Media AI processing then runs in the background so large media does not hold the HTTP request open. When no observation text is supplied, the response initially uses a fallback media-upload note and later updates the observation text from the saved media. Images are converted to a short visible-behavior observation. Audio and video are transcribed. This requires `OPENAI_API_KEY`; if AI conversion is unavailable, the backend keeps the fallback media-upload note.

For plain text observations, the backend generates/refines card display fields before responding: `title`, `description`, `progress`, and emoji-style `icon` such as `\uD83C\uDFE0` or `\uD83D\uDCAC`. For media observations, the response includes fallback display fields immediately and updates them in the background after media processing finishes. Clients can poll `GET /observations/:observationId` and inspect `aiProcessing.status`.

Optional fields: `type`, `text`, `stage`, `indicatorId`, `mood`, `occurredAt`, `reaction`.

If `react` is `"love"` or `"true"`, the backend also creates a `love` reaction from the current user for the new observation.

Response:

```json
{
  "success": true,
  "message": "Observation created successfully",
  "data": {
    "id": "66f...",
    "author": {
      "fullName": "Sarah Martinez",
      "role": "Mom",
      "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
      "initials": "SM"
    },
    "timeAgo": "2 hours ago",
    "observation": "Ava named three colors during play.",
    "title": "Names three colors",
    "description": "Ava identified three colors accurately during play.",
    "progress": 75,
    "icon": "\uD83C\uDFA8",
    "aiProcessing": {
      "status": "completed",
      "queuedAt": "2026-08-17T16:00:00.000Z",
      "startedAt": "2026-08-17T16:00:01.000Z",
      "completedAt": "2026-08-17T16:00:04.000Z",
      "failedAt": null
    },
    "milestone": {
      "detected": true,
      "title": "AI Milestone Detected",
      "domain": "Language",
      "indicator": "Using 3-word sentences"
    },
    "reactions": 6,
    "comments": 2,
    "media": [
      "https://kidport.s3.eu-north-1.amazonaws.com/children/66f.../observations/images/photo.jpg"
    ]
  }
}
```

Possible errors: `400`, `403`, `404`, `503`
### POST `/children/:childId/observations/text`

Auth: required, child access required

Request body:

```json
{
  "text": "Ava followed a two-step instruction.",
  "domainId": "66f...",
  "indicatorId": "66f...",
  "stage": "confident",
  "mood": "focused",
  "occurredAt": "2026-08-10T10:00:00.000Z"
}
```

Response is the same as unified observation creation, with `type: "text"` and `isMilestone: true` for `stage: "confident"`.

### POST `/children/:childId/observations/voice`

Auth: required, child access required

Content type: `multipart/form-data`

Fields:

```text
media: audio/mpeg | audio/wav | audio/mp4
text: optional transcription or note
domainId: optional
indicatorId: optional
stage: emerging | building | steady | confident
mood: optional
occurredAt: optional ISO date
```

Response is the same as unified observation creation, with `type: "voice"`.

### POST `/children/:childId/observations/photo`

Auth: required, child access required

Content type: `multipart/form-data`

Fields:

```text
media: image/jpeg | image/png | image/webp
text: optional caption
domainId: optional
indicatorId: optional
stage: emerging | building | steady | confident
mood: optional
occurredAt: optional ISO date
```

Response is the same as unified observation creation, with `type: "photo"`.

### POST `/children/:childId/observations/video`

Auth: required, child access required

Content type: `multipart/form-data`

Fields:

```text
media: video/mp4 | video/quicktime
text: optional caption
domainId: optional
indicatorId: optional
stage: emerging | building | steady | confident
mood: optional
occurredAt: optional ISO date
```

Response is the same as unified observation creation, with `type: "video"`.

### GET `/observations/:observationId`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Observation",
  "data": {
    "id": "66f...",
    "author": {
      "fullName": "Sarah Martinez",
      "role": "Mom",
      "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
      "initials": "SM"
    },
    "timeAgo": "2 hours ago",
    "observation": "Ava named three colors during play.",
    "title": "Names three colors",
    "description": "Ava identified three colors accurately during play.",
    "progress": 75,
    "icon": "\uD83C\uDFA8",
    "milestone": null,
    "reactions": 6,
    "comments": 2,
    "media": []
  }
}
```

### GET `/observations/:observationId/details`

Auth: required, child access required through observation

Returns one specific observation, total comment count, and all active comment details for that observation.

Response:

```json
{
  "success": true,
  "message": "Observation details",
  "data": {
    "observation": {
      "id": "66f...",
      "author": {
        "fullName": "Sarah Martinez",
        "role": "Mom",
        "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
        "initials": "SM"
      },
      "timeAgo": "2 hours ago",
      "observation": "Emma said her first complete sentence today.",
      "title": "Uses 3-word sentences",
      "description": "Emma can now form simple 3-word sentences.",
      "progress": 80,
      "icon": "\uD83D\uDCAC",
      "milestone": {
        "detected": true,
        "title": "AI Milestone Detected",
        "domain": "Language",
        "indicator": "Using 3-word sentences"
      },
      "reactions": 6,
      "comments": 2,
      "media": []
    },
    "totalComments": 2,
    "comments": [
      {
        "id": "66f...",
        "author": {
          "fullName": "David Martinez",
          "role": "Dad",
          "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
          "initials": "DM"
        },
        "text": "So proud of her! Can't wait to hear more sentences!",
        "timeAgo": "1 hour ago",
        "reactions": 2
      }
    ]
  }
}
```

## Development Progress

### GET `/children/:childId/development-progress`

Auth: required, child access required

Response:

```json
{
  "success": true,
  "message": "Development progress",
  "data": {
    "childId": "66f...",
    "domains": [
      {
        "domainId": "66f...",
        "name": "Language & Literacy",
        "percentage": 75,
        "stage": "steady",
        "keyword": "improving",
        "observationCount": 12
      },
      {
        "domainId": "66f...",
        "name": "Motor",
        "percentage": null,
        "stage": "not_enough_data",
        "keyword": "not-enough-data",
        "observationCount": 0
      }
    ],
    "lastCalculatedAt": "2026-08-10T00:00:00.000Z"
  }
}
```

Domain `keyword` is generated from that child's observations in the domain. Possible values: `improving`, `stable`, `needs-support`, `not-enough-data`.

### GET `/children/:childId/observation-summary`

Auth: required, child access required

Returns the three dashboard counts for the child. The backend recalculates these from the child's latest observations each time this API is called, so the values update after new observations are created.

Response:

```json
{
  "success": true,
  "message": "Observation summary",
  "data": {
    "childId": "66f...",
    "achieved": 3,
    "inProgress": 2,
    "upcoming": 2,
    "lastCalculatedAt": "2026-08-10T00:00:00.000Z"
  }
}
```

AI can refine the status counts from the child observation data. If AI is unavailable, the backend uses deterministic fallback logic: `confident` latest items are `achieved`, observed non-confident items are `inProgress`, and unobserved age-band indicators are `upcoming`.

## Feed and Activity

### GET `/feed`

Auth: required

Query parameters:

```text
page=1
limit=20
childId=66f...
domainId=66f...
startDate=2026-08-01
endDate=2026-08-10
```

Response:

```json
{
  "success": true,
  "message": "Feed",
  "data": [
    {
      "id": "66f...",
      "author": {
        "fullName": "Sarah Martinez",
        "role": "Mom",
        "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
        "initials": "SM"
      },
      "timeAgo": "2 hours ago",
      "observation": "Ava named three colors during play.",
      "title": "Names three colors",
      "description": "Ava identified three colors accurately during play.",
      "progress": 75,
      "icon": "\uD83C\uDFA8",
      "milestone": null,
      "reactions": 6,
      "comments": 2,
      "media": []
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### GET `/children/:childId/activities`

Auth: required, child access required

`data` items use the same compact observation-card shape as `/feed`.

Query parameters:

```text
page=1
limit=20
```

Response:

```json
{
  "success": true,
  "message": "Activities",
  "data": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

### GET `/children/:childId/activity-history`

Auth: required, child access required

`data` items use the same compact observation-card shape as `/feed`.

Query parameters:

```text
domain=66f...
```

Response:

```json
{
  "success": true,
  "message": "Activity history",
  "data": []
}
```

### GET `/activity-history`

Auth: required

Returns paginated observations across all children the authenticated user can access. Supports the same query parameters as `/feed`: `page`, `limit`, `childId`, `domainId`, `startDate`, and `endDate`.

## Milestones and Achievements

### GET `/children/:childId/milestones`

Auth: required, child access required

Query parameters:

```text
domain=66f...
```

Returns observations marked as milestones using the same compact observation-card shape.

Response:

```json
{
  "success": true,
  "message": "Milestones",
  "data": [
    {
      "id": "66f...",
      "author": {
        "fullName": "Sarah Martinez",
        "role": "Mom",
        "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
        "initials": "SM"
      },
      "timeAgo": "2 hours ago",
      "observation": "Ava named three colors during play.",
      "title": "Uses 3-word sentences",
      "description": "Ava used short phrases while describing colors during play.",
      "progress": 100,
      "icon": "\uD83D\uDCAC",
      "milestone": {
        "detected": true,
        "title": "AI Milestone Detected",
        "domain": "Language & Literacy",
        "indicator": "Uses 3-word sentences"
      },
      "reactions": 6,
      "comments": 2,
      "media": [
        "https://kidport.s3.eu-north-1.amazonaws.com/children/66f.../observations/images/photo.jpg"
      ]
    }
  ]
}
```

### GET `/children/:childId/achievements`

Auth: required, child access required

Currently returns the same milestone observation-card shape as `/children/:childId/milestones`.

Response:

```json
{
  "success": true,
  "message": "Achievements",
  "data": [
    {
      "id": "66f...",
      "author": {
        "fullName": "Sarah Martinez",
        "role": "Mom",
        "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
        "initials": "SM"
      },
      "timeAgo": "2 hours ago",
      "observation": "Ava walked 10 steps independently.",
      "title": "Walks independently",
      "description": "Ava walked 10 steps without support.",
      "progress": 100,
      "icon": "\uD83D\uDEB6",
      "milestone": {
        "detected": true,
        "title": "AI Milestone Detected",
        "domain": "Motor",
        "indicator": "Walked 10 Steps Independently"
      },
      "reactions": 6,
      "comments": 2,
      "media": []
    }
  ]
}
```
### GET `/milestones`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Use /children/:childId/milestones for milestone data",
  "data": []
}
```

### GET `/achievements`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Use /children/:childId/achievements for achievement data",
  "data": []
}
```

## Comments

### POST `/observations/:observationId/comments`

Auth: required, child access required through observation

Request body:

```json
{
  "text": "So proud of this progress!"
}
```

Response:

```json
{
  "success": true,
  "message": "Comment created",
  "data": {
    "id": "66f...",
    "author": {
      "fullName": "David Martinez",
      "role": "Dad",
      "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
      "initials": "DM"
    },
    "text": "So proud of her! Can't wait to hear more sentences!",
    "timeAgo": "Just now",
    "reactions": 0
  }
}
```

### GET `/observations/:observationId/comments`

Auth: required, child access required through observation

Query parameters:

```text
page=1
limit=20
```

Response:

```json
{
  "success": true,
  "message": "Comments",
  "data": [
    {
      "id": "66f...",
      "author": {
        "fullName": "David Martinez",
        "role": "Dad",
        "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
        "initials": "DM"
      },
      "text": "So proud of her! Can't wait to hear more sentences!",
      "timeAgo": "1 hour ago",
      "reactions": 0
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0
  }
}
```

### PATCH `/comments/:commentId`

Auth: required, comment author required

Request body:

```json
{
  "text": "Updated comment text"
}
```

Response:

```json
{
  "success": true,
  "message": "Comment updated",
  "data": {
    "_id": "66f...",
    "text": "Updated comment text"
  }
}
```

### POST `/comments/:commentId/reactions`

Auth: required, child access required through comment

Saves a `love` reaction from the current caregiver to a comment. A caregiver can react only once to the same comment.

Request body:

```json
{
  "type": "love"
}
```

Response:

```json
{
  "success": true,
  "message": "Comment reaction saved",
  "data": {
    "id": "66f...",
    "author": {
      "fullName": "David Martinez",
      "role": "Dad",
      "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
      "initials": "DM"
    },
    "text": "So proud of her! Can't wait to hear more sentences!",
    "timeAgo": "1 hour ago",
    "reactions": 2
  }
}
```

### DELETE `/comments/:commentId/reactions`

Auth: required, child access required through comment

Removes the current caregiver's `love` reaction from a comment.

Response:

```json
{
  "success": true,
  "message": "Comment reaction removed",
  "data": {
    "id": "66f...",
    "author": {
      "fullName": "David Martinez",
      "role": "Dad",
      "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
      "initials": "DM"
    },
    "text": "So proud of her! Can't wait to hear more sentences!",
    "timeAgo": "1 hour ago",
    "reactions": 1
  }
}
```

### DELETE `/comments/:commentId`

Auth: required, comment author required

Response:

```json
{
  "success": true,
  "message": "Comment deleted",
  "data": null
}
```

## Reactions

### POST `/observations/:observationId/reactions`

Auth: required, child access required through observation

Saves a `love` reaction from the current caregiver to an observation. A caregiver can react only once to the same observation.

Request body:

```json
{
  "type": "love"
}
```

Response returns the updated compact observation card, including the latest `reactions` count:

```json
{
  "success": true,
  "message": "Reaction saved",
  "data": {
    "id": "66f...",
    "author": {
      "fullName": "Sarah Martinez",
      "role": "Mom",
      "profilePhoto": "https://kidport.s3.eu-north-1.amazonaws.com/users/66f.../profile/photo.jpg",
      "initials": "SM"
    },
    "timeAgo": "2 hours ago",
    "observation": "Emma said her first complete sentence today.",
    "title": "Uses 3-word sentences",
    "description": "Emma can now form simple 3-word sentences.",
    "progress": 80,
    "icon": "\uD83D\uDCAC",
    "milestone": {
      "detected": true,
      "title": "AI Milestone Detected",
      "domain": "Language",
      "indicator": "Using 3-word sentences"
    },
    "reactions": 7,
    "comments": 2,
    "media": []
  }
}
```

### DELETE `/observations/:observationId/reactions`

Auth: required, child access required through observation

Removes the current caregiver's `love` reaction from an observation.

Request body:

```json
{
  "type": "love"
}
```

Response returns the updated compact observation card, including the latest `reactions` count.

```json
{
  "success": true,
  "message": "Reaction removed",
  "data": {
    "id": "66f...",
    "reactions": 6,
    "comments": 2
  }
}
```
## Notifications

### GET `/notifications`

Auth: required

Query parameters:

```text
page=1
limit=20
```

Response:

```json
{
  "success": true,
  "message": "Notifications",
  "data": [
    {
      "_id": "66f...",
      "type": "milestone_achieved",
      "title": "New milestone achieved",
      "body": "Ava reached a confident milestone.",
      "read": false,
      "data": {
        "childId": "66f...",
        "observationId": "66f..."
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1
  }
}
```

### GET `/notifications/unread-count`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Unread notification count",
  "data": {
    "count": 3
  }
}
```

### PATCH `/notifications/:id/read`

Auth: required

Request body: none

Response:

```json
{
  "success": true,
  "message": "Notification read",
  "data": {
    "_id": "66f...",
    "read": true,
    "readAt": "2026-08-10T00:00:00.000Z"
  }
}
```

### PATCH `/notifications/read-all`

Auth: required

Request body: none

Response:

```json
{
  "success": true,
  "message": "All notifications read",
  "data": null
}
```

### DELETE `/notifications/:id`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Notification deleted",
  "data": null
}
```

### DELETE `/notifications/clear-all`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Notifications cleared",
  "data": null
}
```

## Reports

### GET `/children/:childId/reports/development`

Auth: required, child access required

Response:

```json
{
  "success": true,
  "message": "Development report",
  "data": {
    "formatVersion": "development-report-v2",
    "sections": [
      "hero",
      "overallSummary",
      "domainReports",
      "flagsToDiscuss",
      "positiveHighlights",
      "recommendedQuestions",
      "observationData"
    ],
    "hero": {
      "childId": "66f...",
      "childName": "Ava Smith",
      "profileImage": null,
      "ageLabel": "40 months old",
      "dateOfBirthLabel": "DOB: April 12, 2023",
      "reportingPeriodLabel": "Aug 1, 2026 - Aug 10, 2026",
      "caregiversLabel": "3 Caregivers",
      "observationsLabel": "20 Observations",
      "overallScore": {
        "value": 72.5,
        "label": "72.5/100"
      },
      "developmentalAge": {
        "months": 38,
        "years": 3,
        "remainingMonths": 2,
        "days": 0,
        "label": "3 years 2 months 0 days"
      },
      "generatedAtLabel": "Generated August 10, 2026",
      "poweredByAI": true
    },
    "overallSummary": {
      "title": "Overall Summary",
      "rangeLabel": "August 1, 2026 - August 10, 2026",
      "text": "AI summary text"
    },
    "domainReports": [
      {
        "domainId": "66f...",
        "domain": "Language & Literacy",
        "icon": "message-circle",
        "score": 75,
        "scoreLabel": "75/100",
        "status": "stable",
        "statusLabel": "Stable",
        "summary": "Domain summary text",
        "observationCount": 12,
        "tone": "success"
      }
    ],
    "flagsToDiscuss": {
      "count": 2,
      "countLabel": "2 items",
      "items": [
        {
          "domain": "Language",
          "priority": "medium",
          "priorityLabel": "MEDIUM PRIORITY",
          "tone": "warning",
          "title": "Expressive Vocabulary Below Typical Range",
          "description": "Flag description",
          "recommendation": "Recommended next step"
        }
      ]
    },
    "positiveHighlights": {
      "items": [
        {
          "icon": "heart",
          "text": "Positive highlight text"
        }
      ]
    },
    "recommendedQuestions": {
      "items": [
        {
          "number": 1,
          "question": "What should we do next for expressive vocabulary below typical range in Language?",
          "sourceDomain": "Language"
        }
      ]
    },
    "observationData": {
      "totalObservations": 20,
      "reportingPeriod": "August 1, 2026 - August 10, 2026",
      "caregiversContributing": 3,
      "averageObservationsPerWeek": 14,
      "dataQuality": {
        "score": 80,
        "label": "excellent",
        "displayLabel": "Excellent",
        "explanation": "Data quality explanation"
      },
      "framework": "CDC Learn the Signs. Act Early. - 3-4 year milestones",
      "aiEngine": "gpt-4o-mini",
      "contributingCaregivers": [
        {
          "userId": "66f...",
          "name": "Jane Parent",
          "role": "mother",
          "observationCount": 8,
          "badgeLabel": "Jane Parent (Mother)"
        }
      ]
    }
  }
}
```

Notes:

- Numeric scores are deterministic backend calculations.
- AI generates qualitative narrative only.
- Cached report analysis is reused when the source observation set has not changed.
- The response contains only screen-ready report sections.

### GET `/children/:childId/reports/development/pdf`

Auth: required, child access required

Response:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="development-report.pdf"
```

Body: PDF binary.

### POST `/children/:childId/reports/:reportId/share`

Auth: required, child owner required

Request body:

```json
{
  "email": "pediatrician@example.com",
  "message": "Sharing Ava's latest development report."
}
```

Current response:

```json
{
  "success": true,
  "message": "Report share link requested",
  "data": {
    "status": "pending_email_delivery"
  }
}
```

### GET `/reports`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Reports API is available through /children/:childId/reports/*",
  "data": []
}
```

## AI

### POST `/ai/children/:childId/report-analysis/regenerate`

Auth: required, child access required

Request body: none

Response:

```json
{
  "success": true,
  "message": "AI report analysis regenerated",
  "data": {
    "childId": "66f...",
    "overallScore": 72.5,
    "ai": {
      "overallSummary": "...",
      "flagsToDiscuss": [],
      "positiveHighlights": []
    },
    "disclaimer": "This report is generated from caregiver-submitted observations and AI-assisted analysis. It is not a clinical diagnosis and should not replace professional pediatric evaluation."
  }
}
```

### GET `/children/:childId/expert-guidance`

Auth: required, child access required

Response:

```json
{
  "success": true,
  "message": "Expert guidance",
  "data": {
    "disclaimer": "This report is generated from caregiver-submitted observations and AI-assisted analysis. It is not a clinical diagnosis and should not replace professional pediatric evaluation.",
    "suggestions": [
      "Encourage naming familiar objects during play."
    ],
    "questionsToDiscuss": [
      "Should we discuss expressive language progress at the next pediatric visit?"
    ]
  }
}
```

### GET `/expert-guidance`

Auth: required

Response:

```json
{
  "success": true,
  "message": "Use /children/:childId/expert-guidance for child-specific guidance",
  "data": []
}
```

## Support and Feature Requests

### GET `/support/messages`

Auth: required

Returns the authenticated user's support chat thread.

Response:

```json
{
  "success": true,
  "message": "Support messages",
  "data": {
    "thread": {
      "id": "support-66f...",
      "title": "Support Team",
      "subtitle": "Usually replies within minutes"
    },
    "messages": [
      {
        "id": "66f...",
        "sender": "support",
        "text": "Hi Sarah! I'm Maya from KidPort support. How can I help you today?",
        "sentAt": "2026-08-15T10:30:00.000Z",
        "status": "sent"
      }
    ]
  }
}
```

### POST `/support/messages`

Auth: required

Request body:

```json
{
  "text": "I have an issue with uploading an observation."
}
```

Response:

```json
{
  "success": true,
  "message": "Support message sent",
  "data": {
    "thread": {
      "id": "support-66f...",
      "title": "Support Team",
      "subtitle": "Usually replies within minutes"
    },
    "sentMessage": {
      "id": "66f...",
      "sender": "user",
      "text": "I have an issue with uploading an observation.",
      "sentAt": "2026-08-15T09:58:00.000Z",
      "status": "sent"
    },
    "autoReply": {
      "id": "66f...",
      "sender": "support",
      "text": "Thanks for reaching out! Let me help you with that. Could you provide more details?",
      "sentAt": "2026-08-15T09:58:01.000Z",
      "status": "sent"
    }
  }
}
```

### POST `/support/issues`

Auth: required

Content type: `multipart/form-data` or JSON

Request fields:

```json
{
  "title": "Upload failed",
  "description": "Photo observation upload failed on retry.",
  "urgency": "medium"
}
```

Multipart attachment field:

```text
attachments: optional files
```

`urgency`: `low`, `medium`, `high`

Response:

```json
{
  "success": true,
  "message": "Support issue submitted",
  "data": {
    "_id": "66f...",
    "userId": "66f...",
    "title": "Upload failed",
    "urgency": "medium",
    "attachments": [],
    "status": "open"
  }
}
```

### POST `/support/feature-requests`

Auth: required

Content type: `multipart/form-data` or JSON

Request fields:

```json
{
  "title": "Weekly printable summary",
  "description": "Allow parents to export weekly summaries.",
  "impact": "important"
}
```

Multipart image field:

```text
images: optional image files
```

`impact`: `nice_to_have`, `important`, `game_changer`

Response:

```json
{
  "success": true,
  "message": "Feature request submitted",
  "data": {
    "_id": "66f...",
    "userId": "66f...",
    "title": "Weekly printable summary",
    "impact": "important",
    "images": [],
    "status": "submitted"
  }
}
```

### POST `/feature-requests`

Auth: required

Same behavior as `/support/feature-requests`.

## File Upload Rules

Allowed MIME types:

```json
[
  "image/jpeg",
  "image/png",
  "image/webp",
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "video/mp4",
  "video/quicktime",
  "application/pdf"
]
```

Limits:

```json
{
  "maxFileSizeBytes": 52428800,
  "maxFiles": 5
}
```

S3 object key patterns:

```text
users/{userId}/profile/
children/{childId}/profile/
children/{childId}/observations/images/
children/{childId}/observations/audio/
children/{childId}/observations/videos/
children/{childId}/reports/
support/{userId}/
feature-requests/{userId}/
```

## Development Score Algorithm

The backend never asks AI to calculate percentages.

Stage score:

```json
{
  "emerging": 1,
  "building": 2,
  "steady": 3,
  "confident": 4
}
```

Domain percentage:

```text
sum(stageScore) / (4 * scoredObservationCount) * 100
```

Only observed/scored entries participate in the denominator.

No observations:

```json
{
  "percentage": null,
  "stage": "not_enough_data",
  "keyword": "not-enough-data"
}
```

AI may select the domain `keyword` badge from observations, but the backend falls back to deterministic trend logic when AI is unavailable.

Stage mapping:

```json
{
  "1-25": "emerging",
  "26-50": "building",
  "51-75": "steady",
  "76-100": "confident"
}
```

Overall score:

```text
average(domain percentages with data)
```

Domains without observations are excluded from the average.

Milestone rule:

```text
isMilestone = stage === "confident"
```

## Environment Variables

See `.env.example`.

```text
NODE_ENV
PORT
MONGODB_URI
JWT_ACCESS_SECRET
JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRES_IN
JWT_REFRESH_EXPIRES_IN
AWS_REGION
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_S3_BUCKET
AWS_S3_PUBLIC_BASE_URL
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
OPENAI_API_KEY
OPENAI_MODEL
FRONTEND_URL
MOBILE_DEEP_LINK
```

## Integration Notes

- AWS S3 uploads require `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_S3_BUCKET`. Uploaded media responses include a `url`; set `AWS_S3_PUBLIC_BASE_URL` for a CloudFront/custom public base URL, or make the bucket objects publicly readable for the default S3 URL to open directly.
- SMTP email delivery requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`.
- OpenAI narrative generation, media-to-observation conversion, and observation card fields require `OPENAI_API_KEY`; if it is missing, the API returns safe fallback display text and a fallback emoji icon.
- AI output is guidance only and must not be presented as a clinical diagnosis.
