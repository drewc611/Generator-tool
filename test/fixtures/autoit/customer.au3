#include <GUIConstantsEx.au3>

GUICreate("Customer Maintenance", 400, 400)

GUICtrlCreateLabel("Cust No:", 10, 10)
$custNo = GUICtrlCreateInput("", 100, 10, 200, 20)

GUICtrlCreateLabel("Name:", 10, 40)
$custName = GUICtrlCreateInput("", 100, 40, 200, 20)

; a bare input, never assigned to anything: a real gap, named rather than invented
GUICtrlCreateInput("", 100, 70, 200, 20)

GUICtrlCreateLabel("Password:", 10, 100)
$custPassword = GUICtrlCreatePassword("", 100, 100, 200, 20)

$active = GUICtrlCreateCheckbox("Active", 10, 130, 100, 20)

$sizeSmall = GUICtrlCreateRadio("Small", 10, 160, 80, 20)
$sizeMedium = GUICtrlCreateRadio("Medium", 100, 160, 80, 20)

GUICtrlCreateLabel("Shipping:", 10, 190)
$shipStandard = GUICtrlCreateRadio("Standard", 10, 220, _
    100, 20)

$okButton = GUICtrlCreateButton("OK", 10, 260, 80, 25)
$cancelButton = GUICtrlCreateButton("Cancel", 100, 260, 80, 25)
$deleteButton = GUICtrlCreateButton("Delete", 190, 260, 80, 25)

GUISetState(@SW_SHOW)

While 1
    $msg = GUIGetMsg()
    Switch $msg
        Case $GUI_EVENT_CLOSE
            ExitLoop
        Case $okButton
            HandleOk()
        Case $cancelButton
            MsgBox(0, "Cancelled", "Cancelled")
            ExitLoop
    EndSwitch
WEnd
