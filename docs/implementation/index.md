# Implementation

In this section of the documentation we will go over the inner workings of Antimony.

## The Domain

Before going into with any implementation details, lets look at the big picture. The following domain diagram depicts all of Antimony's entities and the relationships between them.

```puml
@startuml Antimony Backend

skinparam backgroundColor transparent

left to right direction
hide <<memory>> stereotype

skinparam padding 2
skinparam class {
    ArrowColor #609E9F
    BorderColor #609E9F
}

<style>
  classDiagram {
    class {
      LineThickness 1.2
      Padding 3
      .memory {
        LineStyle 4
      }
    }
  }
</style>

class Topology {
    GitSourceUrl
    LastDeployFailed
    Definition <<storage>>
    Metadata <<storage>>
}

class BindFile {
    Path
    Content <<storage>>
}

class Lab {
    Name
    StartTime
    EndTime
    Edgeshark
    InstanceName
}

class Instance <<memory>> {
    State
    Deployed
    EdgesharkLink
    LastStateChange
}

class InstanceNode <<memory>> {
    Name
    IPv4
    IPv6
    Port
    User
    WebSSH
    ContainerID
    ContainerName
}

enum InstanceState {
    Deploying
    Running
    Stopping
    Failed
    //Inactive//
    //Scheduled//
}

enum NodeState {
    Running
    Exited
}

class User {
    UserID
    Sub
    Email
}

class Collection {
    Name
    Public Write
    Public Deploy
}

User "0..*" ..o "0..*" Collection : has access to >
note on link
Provided by OIDC
group memberships
end note

Collection "0..*" --o "1" User : created by >
Topology "0..*" --o "1" User : created by >
Topology "0..*" --o "1" Collection : belongs to >
Lab "0..*" --o "1" Topology : deploys >
Lab "0..*" --o "1" User : deployed by >
Lab "1" --o "0..1" Instance : deployed >
Instance -- InstanceState : has >
InstanceNode "1..*" --* "1" Instance : belongs to >
InstanceNode -- NodeState : has >
BindFile "0..*" --* "1" Topology : belongs to >

@enduml
```

Entities with dashed borders are entities that are non-persistent. They only live during Antimony's runtime and need to be re-generated when Antimony is restarted (see [instance reviving](./labs.md#instance-reviving)).

## Entity Ownership

Every main entity (*Topology*, *Lab* and *Collection*) has an owner. The owner of the entity has full control over it and can edit and or delete it.