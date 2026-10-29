import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

public class CConexion {

    private Connection conexion;

    private final String servidor = "DESKTOP-I6HEUP3\\SQLEXPRESS";
    private final String baseDatos = "TallerMecanicoDB";

    public Connection establecerConexion() {

        String url = "jdbc:sqlserver://" + servidor
                + ";databaseName=" + baseDatos
                + ";integratedSecurity=true"
                + ";encrypt=true"
                + ";trustServerCertificate=true";

        try {

            Class.forName("com.microsoft.sqlserver.jdbc.SQLServerDriver");

            conexion = DriverManager.getConnection(url);

            System.out.println("=================================");
            System.out.println("CONEXIÓN EXITOSA");
            System.out.println("Servidor: " + servidor);
            System.out.println("Base de datos: " + baseDatos);
            System.out.println("=================================");

        } catch (ClassNotFoundException e) {

            System.out.println("No se encontró el driver JDBC.");
            e.printStackTrace();

        } catch (SQLException e) {

            System.out.println("Error al conectar con SQL Server.");
            e.printStackTrace();
        }

        return conexion;
    }
}
