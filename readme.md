# Record Service

The Record Service is an HTTP service that allows you to manage records related to emissions data. You can create new records, update existing records, and perform health checks. This README provides instructions on how to use the service and test its functionality.

## Prerequisites

Before running the Record Service, make sure you have the following prerequisites installed:

- Node.js
- npm (Node Package Manager)

## Installation

- `npm install`
- `npm start`

You can also start each service indepedently:

- `npm run start-broker`
- `npm run start-record`
- `npm run start-audit`

## Use

To test out the system, the following commands can be used in the terminal:

#### Create a record

```bash
curl -X POST -H "Content-Type: application/json" -d '{
    "userId": "12345",
    "org": "Updated Organization",
    "emissionGasName": "CO2",
    "quantity": 200,
    "unit": "kg",
}' http://localhost:3000/record
```

If there is no error, the service should return the id of the record created.

#### Update a Record

```bash
curl -X POST -H "Content-Type: application/json" -d '{
    "userId": "12345",
    "org": "Updated Organization",
    "emissionGasName": "CO2",
    "quantity": 200,
    "unit": "kg",
    "recordId": "id-of-the-record"
}' http://localhost:3000/record
```

You can either use the record ID provided when a record was created, or you can try to update an existing fake records by using `fake-record-1`

### Simulate an error

#### Try to update a non-existing record

```bash
curl -X POST -H "Content-Type: application/json" -d '{
    "userId": "12345",
    "org": "Updated Organization",
    "emissionGasName": "CO2",
    "quantity": 200,
    "unit": "kg",
    "recordId": "incorrect-id"
}' http://localhost:3000/record
```

This should give an error message saying that a record could not be found that could be updated

#### Formatting error

Send in a wrong format for the record

```bash
curl -X POST -H "Content-Type: application/json" -d '{
    "invalid_key": "value"
}' http://localhost:3000/record
```

This should provide a error that the payload is not correctly formatted

#### Turn off and on AuditPoint Service

If the AuditPoint service cannot be reach, the Record Service will continue trying to reconnect until it times out.
