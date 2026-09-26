# Permission Model

Authorization follows:

`Subject + Organization + Role + Permission + Resource + Scope + Context -> Allow / Deny`

Initial scopes:

- self
- assigned
- group
- department
- organization

Every protected AI tool must use the same authorization layer as normal API requests.
