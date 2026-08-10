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
      "email": "jane@example.com"
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
  "message": "If the email exists, password reset instructions have been sent",
  "data": null
}
```

### POST `/auth/reset-password`

Auth: none

Request body:

```json
{
  "token": "reset-token-from-email",
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
    "key": "users/66f.../profile/...",
    "mimeType": "image/jpeg",
    "size": 12345,
    "originalName": "profile.jpg"
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
  "language": "en",
  "notifications": {
    "milestoneAchievements": true,
    "careCircleUpdates": false,
    "aiInsights": true,
    "weeklyReports": true
  }
}
```

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

Request body:

```json
{
  "fullName": "Ava Smith",
  "nickname": "Ava",
  "dateOfBirth": "2023-04-12",
  "gender": "female",
  "bloodType": "O+",
  "height": {
    "value": 94,
    "unit": "cm",
    "measuredAt": "2026-08-01"
  },
  "weight": {
    "value": 14,
    "unit": "kg",
    "measuredAt": "2026-08-01"
  }
}
```

Response:

```json
{
  "success": true,
  "message": "Child created",
  "data": {
    "_id": "66f...",
    "fullName": "Ava Smith",
    "nickname": "Ava",
    "dateOfBirth": "2023-04-12T00:00:00.000Z",
    "createdBy": "66f...",
    "caregivers": ["66f..."],
    "status": "active",
    "age": {
      "years": 3,
      "months": 3,
      "totalMonths": 39
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
      "profileImage": {
        "key": "children/66f.../profile/..."
      },
      "name": "Ava",
      "age": {
        "years": 3,
        "months": 3,
        "totalMonths": 39
      },
      "developmentalAge": null,
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

Request body:

```json
{
  "nickname": "Avie",
  "bloodType": "O+",
  "height": {
    "value": 95,
    "unit": "cm",
    "measuredAt": "2026-08-10"
  }
}
```

Response:

```json
{
  "success": true,
  "message": "Child updated",
  "data": {
    "_id": "66f...",
    "nickname": "Avie"
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
    "_id": "66f...",
    "profilePhoto": {
      "key": "children/66f.../profile/...",
      "mimeType": "image/jpeg",
      "size": 12345
    }
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
        "observationCount": 12
      }
    ],
    "pediatricReport": {
      "overallScore": 72.5
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
        "email": "jane@example.com"
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
  "message": "Care circle invitation sent",
  "data": {
    "invitationId": "66f..."
  }
}
```

Notes:

- Sending email does not grant access.
- Access is granted only after explicit invitation acceptance.

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

### POST `/care-circle/invitations/:token/accept`

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

## Daycares

### POST `/daycares`

Auth: required

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

Auth: required, daycare member required

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

Auth: required, daycare admin required

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
  "message": "Daycare invitation sent",
  "data": {
    "invitationId": "66f..."
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

### POST `/daycare-invitations/:token/accept`

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
  "name": "Language & Literacy",
  "slug": "language-literacy",
  "description": "Language and early literacy indicators",
  "sortOrder": 1
}
```

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
  "type": "photo",
  "text": "Ava named three colors during play.",
  "domainId": "66f...",
  "indicatorId": "66f...",
  "stage": "steady",
  "mood": "happy",
  "occurredAt": "2026-08-10T10:00:00.000Z"
}
```

Multipart media field:

```text
media: one or more files
```

Response:

```json
{
  "success": true,
  "message": "Observation created successfully",
  "data": {
    "_id": "66f...",
    "childId": "66f...",
    "authorId": "66f...",
    "type": "photo",
    "text": "Ava named three colors during play.",
    "domainId": "66f...",
    "indicatorId": "66f...",
    "stage": "steady",
    "stageScore": 3,
    "isMilestone": false,
    "media": [],
    "status": "active"
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
    "_id": "66f...",
    "childId": "66f...",
    "type": "text",
    "stage": "steady",
    "stageScore": 3
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
        "observationCount": 12
      },
      {
        "domainId": "66f...",
        "name": "Motor",
        "percentage": null,
        "stage": "not_enough_data",
        "observationCount": 0
      }
    ],
    "lastCalculatedAt": "2026-08-10T00:00:00.000Z"
  }
}
```

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
      "_id": "66f...",
      "childId": {
        "_id": "66f...",
        "fullName": "Ava Smith"
      },
      "authorId": {
        "_id": "66f...",
        "fullName": "Jane Parent"
      },
      "type": "text",
      "stage": "steady",
      "isMilestone": false,
      "createdAt": "2026-08-10T00:00:00.000Z"
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

Note: top-level group placeholder exists. Prefer `/children/:childId/activity-history` for child-specific data.

## Milestones and Achievements

### GET `/children/:childId/milestones`

Auth: required, child access required

Query parameters:

```text
domain=66f...
```

Response:

```json
{
  "success": true,
  "message": "Milestones",
  "data": [
    {
      "_id": "66f...",
      "childId": "66f...",
      "indicatorId": {
        "_id": "66f...",
        "title": "Uses 3-word sentences"
      },
      "domainId": {
        "_id": "66f...",
        "name": "Language & Literacy"
      },
      "stage": "confident",
      "stageScore": 4,
      "isMilestone": true,
      "occurredAt": "2026-08-10T00:00:00.000Z"
    }
  ]
}
```

### GET `/children/:childId/achievements`

Auth: required, child access required

Response:

```json
{
  "success": true,
  "message": "Achievements",
  "data": [
    {
      "_id": "66f...",
      "indicatorId": {
        "_id": "66f...",
        "title": "Walked 10 Steps Independently"
      },
      "stage": "confident",
      "isMilestone": true,
      "occurredAt": "2026-08-10T00:00:00.000Z"
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
    "_id": "66f...",
    "observationId": "66f...",
    "childId": "66f...",
    "authorId": "66f...",
    "text": "So proud of this progress!",
    "status": "active"
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
  "data": [],
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
  "message": "Reaction saved",
  "data": {
    "_id": "66f...",
    "observationId": "66f...",
    "childId": "66f...",
    "userId": "66f...",
    "type": "love"
  }
}
```

### DELETE `/observations/:observationId/reactions`

Auth: required

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
  "message": "Reaction removed",
  "data": null
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
    "childId": "66f...",
    "child": {
      "id": "66f...",
      "fullName": "Ava Smith",
      "dateOfBirth": "2023-04-12T00:00:00.000Z"
    },
    "overallScore": 72.5,
    "progress": [
      {
        "domainId": "66f...",
        "name": "Language & Literacy",
        "percentage": 75,
        "stage": "steady",
        "observationCount": 12
      }
    ],
    "reportingPeriod": {
      "startDate": "2026-08-01T00:00:00.000Z",
      "endDate": "2026-08-10T00:00:00.000Z"
    },
    "totalObservations": 20,
    "caregiversContributing": 3,
    "contributors": [
      {
        "userId": "66f...",
        "name": "Jane Parent",
        "role": "mother",
        "observationCount": 8
      }
    ],
    "averageObservationsPerWeek": 14,
    "dataQuality": {
      "score": 80,
      "label": "excellent"
    },
    "ai": {
      "overallSummary": "AI summary text",
      "domainSummaries": [],
      "flagsToDiscuss": [],
      "positiveHighlights": [],
      "dataQualityExplanation": "..."
    },
    "disclaimer": "This report is generated from caregiver-submitted observations and AI-assisted analysis. It is not a clinical diagnosis and should not replace professional pediatric evaluation.",
    "generatedAt": "2026-08-10T00:00:00.000Z"
  }
}
```

Notes:

- Numeric scores are deterministic backend calculations.
- AI generates qualitative narrative only.
- Cached report analysis is reused when the source observation set has not changed.

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

### POST `/support/issues`

Auth: required

Content type: `multipart/form-data` or JSON

Request fields:

```json
{
  "issueType": "bug_error",
  "title": "Upload failed",
  "description": "Photo observation upload failed on retry.",
  "urgency": "medium"
}
```

Multipart attachment field:

```text
attachments: optional files
```

`issueType`: `bug_error`, `app_crash`, `performance`, `other`

`urgency`: `low`, `medium`, `high`

Response:

```json
{
  "success": true,
  "message": "Support issue submitted",
  "data": {
    "_id": "66f...",
    "userId": "66f...",
    "issueType": "bug_error",
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
  "type": "new_feature",
  "title": "Weekly printable summary",
  "description": "Allow parents to export weekly summaries.",
  "impact": "important"
}
```

Multipart image field:

```text
images: optional image files
```

`type`: `new_feature`, `improvement`, `design_ui`, `integration`

`impact`: `nice_to_have`, `important`, `game_changer`

Response:

```json
{
  "success": true,
  "message": "Feature request submitted",
  "data": {
    "_id": "66f...",
    "userId": "66f...",
    "type": "new_feature",
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

## Deterministic Development Score Algorithm

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
  "stage": "not_enough_data"
}
```

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

- AWS S3 uploads require `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_S3_BUCKET`.
- SMTP email delivery requires `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`.
- OpenAI narrative generation requires `OPENAI_API_KEY`; if it is missing, the API returns a safe fallback message.
- AI output is guidance only and must not be presented as a clinical diagnosis.
