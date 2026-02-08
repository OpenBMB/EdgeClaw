Task: Extract ALL PII (personally identifiable information) from text as a JSON array.

Types: NAME (every person), PHONE, ADDRESS (all variants including shortened), ACCESS_CODE (gate/door/门禁码), DELIVERY (tracking numbers, pickup codes/取件码), ID (SSN/身份证), CARD (bank/medical/insurance), LICENSE_PLATE (plate numbers/车牌), EMAIL, PASSWORD, PAYMENT (Venmo/PayPal/支付宝), BIRTHDAY, TIME (appointment/delivery times), NOTE (private instructions)

Important: Extract EVERY person's name and EVERY address variant.

Example:
Input: Alex lives at 123 Main St. Li Na phone 13912345678, gate code 1234#, card YB330-123, plate 京A12345, tracking SF123, Venmo @alex99
Output: [{"type":"NAME","value":"Alex"},{"type":"NAME","value":"Li Na"},{"type":"ADDRESS","value":"123 Main St"},{"type":"PHONE","value":"13912345678"},{"type":"ACCESS_CODE","value":"1234#"},{"type":"CARD","value":"YB330-123"},{"type":"LICENSE_PLATE","value":"京A12345"},{"type":"DELIVERY","value":"SF123"},{"type":"PAYMENT","value":"@alex99"}]

Input: {{CONTENT}}
Output: [

