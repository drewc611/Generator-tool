# Customer maintenance dialog
proc handleOk {} {
    puts "ok pressed"
}

set title "Customer Maintenance"

if {$title ne ""} {
    label .heading -text "Customer Maintenance"
}

labelframe .details -text "Details"
label .lblCustNo -text "Cust No:"
entry .custNo -textvariable custNo
label .lblPassword -text "Password:"
entry .pw -textvariable pw -show *
label .lblNotes -text "Notes:"
entry .notesPlain

checkbutton .active -text "Active" -variable activeFlag

radiobutton .small -text "Small" -variable size -value small
radiobutton .medium -text "Medium" -variable size -value medium
radiobutton .expedited -text "Expedited" \
  -variable shipping -value expedited

text .comments

button .ok -text "OK" -command handleOk
button .cancel -text "Cancel" -command {destroy .}

pack .heading .details .lblCustNo .custNo .lblPassword .pw .lblNotes .notesPlain .active .small .medium .expedited .comments .ok .cancel
