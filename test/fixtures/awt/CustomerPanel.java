import java.awt.event.ActionListener;
import java.awt.event.ActionEvent;
import javax.swing.*;

public class CustomerPanel extends JPanel {
    private JTextField custNoField;
    private JTextField custNameField;
    private JCheckBox activeCheck;

    public CustomerPanel() {
        JLabel custNoLabel = new JLabel("Cust No:");
        add(custNoLabel);

        custNoField = new JTextField(10);
        add(custNoField);

        // a caption built from a variable, not a literal: a real gap, named rather than guessed
        String nameCaption = fetchNameCaption();
        JLabel custNameLabel = new JLabel(nameCaption);
        add(custNameLabel);

        custNameField = new JTextField(30);
        add(custNameField);

        // never assigned to anything at all: a real gap, named rather than invented
        add(new JTextField(5));

        activeCheck = new JCheckBox("Active");
        add(activeCheck);

        JComboBox regionChoice = new JComboBox();
        regionChoice.addItem("East");
        regionChoice.addItem("West");
        add(regionChoice);

        JButton okButton = new JButton("OK");
        okButton.addActionListener(e -> handleOk());
        add(okButton);

        JButton applyButton = new JButton("Apply");
        applyButton.addActionListener(e -> {
            handleApply();
            refresh();
        });
        add(applyButton);

        JButton cancelButton = new JButton("Cancel");
        add(cancelButton);
    }

    private String fetchNameCaption() {
        return "Name:";
    }

    private void handleOk() {
    }

    private void handleApply() {
    }

    private void refresh() {
    }
}
